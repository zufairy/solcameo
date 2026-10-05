// JEV lab API (/dev/jev) — pick clip moments from a system video WITHOUT the
// LLM analyzer, the jev-video-search way (github.com/Anmol-Srv/jev-video-search):
//   transcript windows → retriever shortlist (Kie LLM rerank over BM25, or a
//   local Ollama embedding when OLLAMA_HOST is set) →
//   Jev judge per candidate (scripts/jev/jev_score.py) → non-overlapping picks
// then cut every pick from ONE download of the source with plain ffmpeg.
//
// POST { action: "search", sourceUrl, originUrl?, query, maxClips?, minLen?, maxLen?, topK?, useJev? }
// POST { action: "cut", sourceUrl, moments: [{ start, end }], vertical? }
// GET  → service status + the speed/cost ledger (lib/server/jev/metrics.ts)
//
// Every cut is re-encoded with the "Made by Vello" watermark burned in (same
// mark as captions-lab / overlay-burn) — there is no un-watermarked output.
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchSelf } from "@/lib/server/fetchInternal";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { putVideo, putVideoFile, r2Configured } from "@/lib/server/videoStorage";
import { writeVelloWatermark } from "@/lib/server/velloWatermark";
import { cachedSource, probeVideo } from "@/lib/server/jev/sourceCache";
import { jevGate } from "@/lib/server/jev/gate";
import { RATES, addClips, costOf, cpuCost, listClips, listRuns, listUploads, recordRun, sttCost, storageCost } from "@/lib/server/jev/metrics";
import {
  JEV_FLOOR, buildWindows, isGenericQuery, lexicalShortlist, pickNonOverlapping,
  rankCandidates, resegment, titleFromText, topK, type Candidate, type Seg, type Word,
} from "@/lib/server/jev/moments";
import { heuristicShortlist, jevReady, jevScores, pickBestMoments, retrieve } from "@/lib/server/jev/jevClient";

export const runtime = "nodejs";
export const maxDuration = 300;

type Transcript = { segments: Seg[]; words: Word[]; durationSeconds: number; cached: boolean; provider?: string };

// Transcript per source, in memory AND on disk: a skipAnalysis miss is not
// written to the shared transcript cache, so without this every server restart
// (or dev hot reload) would pay for the same video's STT again.
const transcriptMemo = new Map<string, Transcript>();
const transcriptInFlight = new Map<string, Promise<Transcript>>();
const DISK_DIR = join(tmpdir(), "vello-jev-transcripts");
const diskPath = (url: string) => join(DISK_DIR, `${createHash("sha1").update(url).digest("hex")}.json`);

type TranscribeRes = {
  ok?: boolean; miss?: boolean; error?: string; segments?: Seg[]; words?: Word[]; durationSeconds?: number; cached?: boolean; provider?: string;
};

async function transcribe(body: Record<string, unknown>, req: NextRequest): Promise<{ res: Response; j: TranscribeRes }> {
  const res = await fetchSelf("/api/video/transcribe-clip", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET ?? "" },
    // skipAnalysis: transcript only — the LLM moment analysis is exactly what JEV replaces.
    body: JSON.stringify({ ...body, skipAnalysis: true }),
    // Under undici's 300s headers timeout: that "fetch failed" makes fetchSelf retry
    // on the next base and transcribe the whole video twice. An aborted signal
    // fails the retry instantly instead.
    signal: AbortSignal.timeout(270_000),
  }, req);
  return { res, j: (await res.json().catch(() => ({}))) as TranscribeRes };
}

/**
 * The master transcript cache is keyed on the ORIGINAL source (the YouTube /
 * Drive link a download came from), not the R2 copy we play and cut. Probe the
 * original first — a video the clipper already processed is then a free, instant
 * HIT — and only on a miss transcribe the R2 copy (no Drive/YouTube re-download).
 */
async function loadTranscript(sourceUrl: string, originUrl: string, req: NextRequest): Promise<Transcript> {
  const memo = transcriptMemo.get(sourceUrl);
  if (memo) return { ...memo, cached: true };
  try {
    const disk = JSON.parse(await readFile(diskPath(sourceUrl), "utf8")) as Transcript;
    if (disk.segments?.length) {
      transcriptMemo.set(sourceUrl, disk);
      return { ...disk, cached: true };
    }
  } catch { /* no disk copy */ }
  let hit: TranscribeRes | null = null;
  if (originUrl && originUrl !== sourceUrl) {
    const probe = await transcribe({ sourceUrl: originUrl, cacheOnly: true }, req).catch(() => null);
    if (probe?.res.ok && probe.j.ok && !probe.j.miss && probe.j.segments?.length) hit = probe.j;
  }
  let j: TranscribeRes;
  if (hit) j = hit;
  else {
    const r = await transcribe({ sourceUrl }, req);
    if (!r.res.ok || !r.j.ok) throw new Error(r.j.error || `transcribe-clip HTTP ${r.res.status}`);
    j = r.j;
  }
  const t: Transcript = {
    segments: j.segments ?? [], words: j.words ?? [], durationSeconds: j.durationSeconds ?? 0, cached: !!j.cached,
    provider: j.provider,
  };
  if (t.segments.length) {
    transcriptMemo.set(sourceUrl, t);
    if (transcriptMemo.size > 30) transcriptMemo.delete(transcriptMemo.keys().next().value as string);
    await mkdir(DISK_DIR, { recursive: true }).then(() => writeFile(diskPath(sourceUrl), JSON.stringify(t))).catch(() => {});
  }
  return t;
}

async function getTranscript(sourceUrl: string, originUrl: string, req: NextRequest): Promise<Transcript> {
  const key = originUrl || sourceUrl;
  const running = transcriptInFlight.get(key);
  if (running) return { ...(await running), cached: true };
  const promise = loadTranscript(sourceUrl, originUrl, req);
  transcriptInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (transcriptInFlight.get(key) === promise) transcriptInFlight.delete(key);
  }
}

const num = (v: unknown, d: number, lo: number, hi: number) => {
  const n = Number(v);
  return v !== undefined && v !== null && v !== "" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** What a search consumed, filled in as it runs — the wrapper turns it into a ledger row. */
type SearchUsage = { tr?: Transcript; jevCalls: number; kieCalls: number };

async function search(body: Record<string, unknown>, req: NextRequest) {
  const usage: SearchUsage = { jevCalls: 0, kieCalls: 0 };
  const t0 = Date.now();
  let res: NextResponse;
  let error: string | undefined;
  try {
    res = await searchInner(body, req, usage);
    if (!res.ok) error = ((await res.clone().json().catch(() => ({}))) as { error?: string }).error;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    res = NextResponse.json({ ok: false, error }, { status: 500 });
  }
  const tr = usage.tr;
  const payload = res.ok ? ((await res.clone().json()) as Record<string, unknown>) : null;
  const stats = (payload?.stats ?? {}) as Record<string, number>;
  const run = await recordRun({
    kind: "search", ok: !error, error, sourceUrl: String(body.sourceUrl ?? ""), sourceName: typeof body.sourceName === "string" ? body.sourceName : undefined,
    query: String(body.query ?? ""), durationSeconds: tr?.durationSeconds,
    mode: typeof payload?.mode === "string" ? payload.mode : "query",
    retriever: typeof payload?.retriever === "string" ? payload.retriever : undefined,
    provider: tr?.provider, transcriptCached: tr?.cached,
    clips: Array.isArray(payload?.moments) ? payload.moments.length : 0,
    jevCalls: usage.jevCalls, kieCalls: usage.kieCalls,
    ms: {
      total: Date.now() - t0, transcript: stats.transcriptMs ?? 0, retrieve: stats.retrieveMs ?? 0, jev: stats.jevMs ?? 0,
    },
    cost: costOf({
      // A cached transcript was paid for on an earlier run.
      stt: tr && !tr.cached ? sttCost(tr.durationSeconds, tr.provider) : 0,
      jev: usage.jevCalls * RATES.jevPerCall,
      kie: usage.kieCalls * RATES.kiePerCall,
    }),
  });
  if (!payload) return res;
  return NextResponse.json({ ...payload, cost: run.cost, provider: tr?.provider ?? null });
}

async function searchInner(body: Record<string, unknown>, req: NextRequest, usage: SearchUsage) {
  const sourceUrl = String(body.sourceUrl ?? "").trim();
  const query = String(body.query ?? "").trim();
  if (!sourceUrl || !query) return NextResponse.json({ ok: false, error: "sourceUrl and query required" }, { status: 400 });
  const maxClips = num(body.maxClips, 5, 1, 30);
  const minLen = num(body.minLen, 20, 5, 120);
  const maxLen = Math.max(minLen + 5, num(body.maxLen, 60, 10, 180));
  // One 25-wide JEV wave is the upstream sweet spot. More candidates add
  // latency and provider pressure but rarely improve a five-clip result.
  const k = num(body.topK, 25, 5, 50);
  const useJev = body.useJev !== false;

  const t0 = Date.now();
  const tr = await getTranscript(sourceUrl, String(body.originUrl ?? "").trim(), req);
  usage.tr = tr;
  const tTranscript = Date.now() - t0;
  if (!tr.segments.length) return NextResponse.json({ ok: false, error: "no speech in this video's transcript" }, { status: 422 });

  const units = resegment(tr.words, tr.segments);
  const windows = buildWindows(units, minLen, maxLen);
  if (!windows.length) {
    return NextResponse.json({ ok: false, error: `no ${minLen}-${maxLen}s window fits this transcript` }, { status: 422 });
  }

  // "best moments" / "highlights" / etc name no specific content for Jev to
  // match a caption against — literal matching against that literal phrase
  // correctly finds nothing, which isn't actually what the user asked for.
  // Reason over the transcript directly instead: ONE Kie call judges a
  // heuristically-shortlisted pool and PICKS what's worth clipping, the way a
  // person skimming for highlights would, rather than testing each window
  // against a query that names nothing.
  if (isGenericQuery(query)) {
    const poolIdx = heuristicShortlist(windows.map((w) => w.text), Math.min(k, 80));
    const pool = poolIdx.map((i) => windows[i]);
    const tBest = Date.now();
    usage.kieCalls += 1;
    const picks = await pickBestMoments(pool.map((w) => w.text), maxClips);
    const chosen = pickNonOverlapping(
      picks.map((p, n) => ({ ...pool[p.i], id: n, sim: 0, simRank: n + 1, jev: null })),
      maxClips,
    );
    const reasonByStart = new Map(picks.map((p) => [pool[p.i].start, p.reason]));
    return NextResponse.json({
      ok: true,
      query,
      mode: "best-moments",
      moments: chosen.map((c) => ({
        start: c.start, end: c.end, title: reasonByStart.get(c.start) || titleFromText(c.text), text: c.text,
        jev: null, sim: 0, simRank: c.simRank,
      })),
      shortlist: [],
      floor: JEV_FLOOR,
      retriever: "kie" as const,
      notes: chosen.length === 0 ? ["Kie found nothing worth clipping in this video — try a more specific query."] : [],
      jevApplied: false,
      stats: {
        durationSeconds: tr.durationSeconds, segments: units.length, windows: windows.length,
        candidates: pool.length, jevScored: 0, transcriptCached: tr.cached,
        transcriptMs: tTranscript, retrieveMs: Date.now() - tBest, jevMs: 0, totalMs: Date.now() - t0,
      },
    });
  }

  const t1 = Date.now();
  const ret = await retrieve(`${sourceUrl}|${minLen}|${maxLen}`, query, windows.map((w) => w.text), k);
  // With Jev on, a keyword retriever only seeds the shortlist (see lexicalShortlist);
  // without Jev its order is the answer, so keep plain top-k.
  const order = ret.retriever === "bm25" && useJev ? lexicalShortlist(ret.scores, k) : topK(ret.scores, k);
  const tRetrieve = Date.now() - t1;
  if (ret.retriever === "kie") usage.kieCalls += 1;
  const shortlist: Candidate[] = order.map((i, n) => ({ ...windows[i], sim: ret.scores[i], simRank: n + 1, jev: null }));

  const t2 = Date.now();
  const jev = useJev
    ? await jevScores(query, shortlist.map((c) => c.text))
    : { scores: shortlist.map(() => null), applied: false, error: "disabled" };
  const tJev = Date.now() - t2;
  // Billed per request that got an answer; unanswered ones (timeouts) aren't.
  usage.jevCalls = jev.scores.filter((s) => s !== null).length;
  shortlist.forEach((c, i) => { c.jev = jev.scores[i]; });

  const ranked = rankCandidates(shortlist);
  const scoredCount = jev.scores.filter((s) => s !== null).length;
  // jev.applied only means "at least one candidate scored" — on its own that's
  // NOT enough to trust the floor filter. A rate limit or network blip can fail
  // most of a shortlist (only a few requests happen to land), and those few
  // survivors landing low then read as "nothing here matches" even though the
  // real matches were simply never evaluated (null), not rejected. Require a
  // majority scored before treating the floor as a real verdict; otherwise fall
  // back to the retriever's own order, same as a total Jev failure would.
  const jevReliable = jev.applied && scoredCount >= Math.ceil(shortlist.length * 0.5);
  // Without a reliable Jev pass, the retriever order stands — embeddings/kie
  // always return k, but plain BM25 can at least abstain on windows sharing no
  // word with the query.
  const eligible = jevReliable
    ? ranked.filter((c) => c.jev !== null && c.jev >= JEV_FLOOR)
    : ret.retriever === "bm25" ? ranked.filter((c) => c.sim > 0) : ranked;
  const picks = pickNonOverlapping(eligible, maxClips);

  return NextResponse.json({
    ok: true,
    query,
    moments: picks.map((c) => ({
      start: c.start, end: c.end, title: titleFromText(c.text), text: c.text,
      jev: c.jev, sim: c.sim, simRank: c.simRank,
    })),
    shortlist: ranked.map((c, n) => ({
      start: c.start, end: c.end, text: c.text, jev: c.jev, sim: c.sim, simRank: c.simRank, jevRank: n + 1,
    })),
    floor: JEV_FLOOR,
    retriever: ret.retriever,
    notes: [
      ret.note,
      useJev && jev.error ? `Jev not applied: ${jev.error}` : undefined,
      useJev && jev.applied && !jevReliable
        ? `Jev only scored ${scoredCount}/${shortlist.length} candidates (rate-limited or timed out) — showing the best ${ret.retriever} matches instead of Jev's verdict.`
        : undefined,
    ].filter(Boolean),
    jevApplied: jevReliable,
    stats: {
      durationSeconds: tr.durationSeconds, segments: units.length, windows: windows.length,
      candidates: shortlist.length, jevScored: jev.scores.filter((s) => s !== null).length,
      transcriptCached: tr.cached,
      transcriptMs: tTranscript, retrieveMs: tRetrieve, jevMs: tJev, totalMs: Date.now() - t0,
    },
  });
}

function ffmpeg(args: string[]): Promise<void> {
  const bin = resolveFfmpegPath();
  if (!bin) return Promise.reject(new Error("ffmpeg binary not found"));
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-600); });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim().split("\n").pop()}`))));
  });
}

type CutResult =
  | { ok: true; start: number; end: number; clipUrl: string; bytes: number; encodeMs: number }
  | { ok: false; start: number; end: number; error: string };

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Output frame size: 9:16 center crop at the source's resolution class (a
 *  720p source upscaled to 1080x1920 is ~3x the encode for no added detail),
 *  or the source aspect capped at 720p tall — this is a speed demo, and 720p is
 *  what the clip gets watched at on a phone anyway. */
function outputSize(vertical: boolean, src: { width: number; height: number } | null): { w: number; h: number } {
  if (vertical) return src && src.height >= 1920 ? { w: 1080, h: 1920 } : { w: 720, h: 1280 };
  if (!src) return { w: 1280, h: 720 };
  const h = Math.min(720, src.height - (src.height % 2));
  return { w: Math.max(2, Math.round((src.width * h) / src.height / 2) * 2), h };
}

async function cut(body: Record<string, unknown>, userId: string) {
  const sourceUrl = String(body.sourceUrl ?? "").trim();
  const raw = Array.isArray(body.moments) ? (body.moments as { start?: unknown; end?: unknown; title?: unknown }[]) : [];
  const titles = new Map<string, string>();
  const moments = raw
    .map((m) => {
      const c = { start: Number(m.start), end: Number(m.end) };
      if (typeof m.title === "string") titles.set(`${c.start}-${c.end}`, m.title.slice(0, 140));
      return c;
    })
    .filter((m) => Number.isFinite(m.start) && Number.isFinite(m.end) && m.start >= 0 && m.end > m.start && m.end - m.start <= 180)
    .slice(0, 30);
  if (!sourceUrl || !moments.length) return NextResponse.json({ ok: false, error: "sourceUrl + moments required" }, { status: 400 });
  const vertical = body.vertical === true;
  const ffmpegBin = resolveFfmpegPath();

  const t0 = Date.now();
  const dir = await mkdtemp(join(tmpdir(), "vello-jev-"));
  try {
    // ONE download for every clip (the canvas /api/video/clip route re-fetches
    // the whole source per clip — the main reason batch cutting was slow), kept
    // on disk so re-cutting the same video skips the download entirely.
    const src = await cachedSource(sourceUrl, dir);
    const tDownload = Date.now() - t0;

    const probe = ffmpegBin ? await probeVideo(ffmpegBin, src.path) : null;
    const { w, h } = outputSize(vertical, probe);
    // Full-frame transparent PNG at the exact output size: overlay at 0:0 keeps
    // the mark's percentage placement identical to captions-lab.
    const mark = await writeVelloWatermark(join(dir, "vello-watermark.png"), w, h);
    const base = vertical
      ? `crop='min(iw,ih*9/16)':ih,scale=${w}:${h}`
      : probe ? `scale=${w}:${h}` : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
    const graph = `[0:v]${base},setsar=1,fps=30[b];[b][1:v]overlay=0:0[v]`;

    const results: CutResult[] = [];
    let next = 0;
    const worker = async () => {
      while (next < moments.length) {
        const idx = next++;
        const m = moments[idx];
        const out = join(dir, `clip-${idx}.mp4`);
        try {
          const te = Date.now();
          // Input seek + re-encode: frame-accurate cut points, ultrafast preset
          // (a few points of compression efficiency cost nothing here — encode
          // wall-time is what the user is waiting on).
          await ffmpeg(["-nostdin", "-loglevel", "error", "-ss", m.start.toFixed(3), "-i", src.path, "-i", mark,
            "-t", (m.end - m.start).toFixed(3), "-filter_complex", graph, "-map", "[v]", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-y", out]);
          const encodeMs = Date.now() - te;
          const bytes = (await stat(out)).size;
          const stored = r2Configured()
            ? await putVideoFile(out, bytes, { keyPrefix: "clips/jev" })
            : await putVideo(new Uint8Array(await readFile(out)), { keyPrefix: "clips/jev" });
          results[idx] = { ok: true, ...m, clipUrl: stored.url, bytes, encodeMs };
        } catch (e) {
          results[idx] = { ok: false, ...m, error: e instanceof Error ? e.message : String(e) };
        }
      }
    };
    // 5 parallel ffmpeg workers — bounded so it does not starve other traffic
    // on the same box; each worker is CPU-bound on ffmpeg, not I/O.
    await Promise.all(Array.from({ length: Math.min(5, moments.length) }, worker));

    const done = results.filter((r): r is Extract<CutResult, { ok: true }> => r.ok);
    const outBytes = done.reduce((n, r) => n + r.bytes, 0);
    const encodeMs = done.reduce((n, r) => n + r.encodeMs, 0);
    const clipSeconds = done.reduce((n, r) => n + (r.end - r.start), 0);
    const stats = {
      downloadMs: tDownload, sourceCached: src.hit, encodeMs, totalMs: Date.now() - t0,
      clipSeconds, outBytes, width: w, height: h, watermark: true,
    };
    // Into the user's clip library, so "Your clips" still has them after a reload.
    const sourceName = typeof body.sourceName === "string" ? body.sourceName.slice(0, 200) : undefined;
    await addClips(userId, done.map((r) => ({
      url: r.clipUrl, at: Date.now(), start: r.start, end: r.end,
      title: titles.get(`${r.start}-${r.end}`) ?? `Clip ${fmtTime(r.start)}–${fmtTime(r.end)}`,
      sourceUrl, sourceName, width: w, height: h,
    })));
    const run = await recordRun({
      kind: "cut", ok: done.length > 0, error: done.length ? undefined : results.find((r) => !r.ok && "error" in r)?.error,
      sourceUrl, clips: done.length, bytes: outBytes,
      ms: { total: stats.totalMs, download: tDownload, encode: encodeMs },
      // ultrafast x264 saturates ~one core per worker, so summed encode wall
      // time ≈ CPU time.
      cost: costOf({ compute: cpuCost(encodeMs), storage: storageCost(outBytes), requests: done.length * RATES.r2PerPut }),
    });
    return NextResponse.json({ ok: true, clips: results, stats, cost: run.cost });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await recordRun({ kind: "cut", ok: false, error, sourceUrl, clips: 0, ms: { total: Date.now() - t0 }, cost: costOf({}) });
    return NextResponse.json({ ok: false, error }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Status panel feed: what's wired up on this server + the ledger. Read-only,
 *  no secrets — only whether each dependency is configured. */
export async function GET() {
  const jev = jevReady();
  const { runs, totals } = await listRuns(40);
  return NextResponse.json({
    ok: true,
    status: {
      r2: r2Configured(),
      ffmpeg: !!resolveFfmpegPath(),
      jev: jev.ok, jevReason: jev.reason ?? null,
      stt: process.env.ELEVENLABS_API_KEY ? "elevenlabs" : process.env.KIE_API_KEY || process.env.KIE_API_TOKEN ? "kie-gemini" : null,
      authRequired: process.env.NODE_ENV === "production",
    },
    rates: RATES,
    runs,
    totals,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const gate = await jevGate(req);
  if (gate.denied) return gate.denied;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  try {
    if (body.action === "search") return await search(body, req);
    if (body.action === "cut") return await cut(body, gate.userId);
    if (body.action === "clips") return NextResponse.json({ ok: true, clips: await listClips(gate.userId) });
    // Cheap auth probe the page fires (through the app's fetch interceptor, which
    // mints the SIWS session) before an XHR upload — XHR bypasses that interceptor.
    if (body.action === "auth") return NextResponse.json({ ok: true });
    if (body.action === "uploads") return NextResponse.json({ ok: true, uploads: await listUploads(gate.userId) });
    return NextResponse.json({ ok: false, error: "action must be search | cut | auth | uploads | clips" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
