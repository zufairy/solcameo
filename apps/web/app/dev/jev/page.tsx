"use client";

/* ════════ /dev/jev — query-driven clipping, no LLM analyzer ════════
   Port of github.com/Anmol-Srv/jev-video-search onto system videos: the
   transcript is cut into sentence-aligned windows, a retriever shortlists the
   ones near the query (a single Kie LLM rerank over a BM25 shortlist, or a
   local Ollama embedding when configured), Jev judges each
   shortlisted window against the query and can abstain, and the picks are cut
   from one download of the source. Server side: app/api/dev/jev/route.ts.
   Own videos upload straight to R2 (app/api/media/upload-jev) and are searched
   the moment they land; every cut ships with the Made-by-Vello watermark. The
   right-hand panel is the speed + cost ledger (GET /api/dev/jev). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { LabTabs } from "@/components/dev-lab/lab-tabs";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { unionWalletAddresses } from "@/lib/solana/activeWallet";
import { getCurrentSiwsToken } from "@/lib/client/siwsIdentity";
import { Download, Loader2, Scissors, Upload } from "lucide-react";

type Moment = { start: number; end: number; title: string; text: string; jev: number | null; sim: number; simRank: number };
type Short = { start: number; end: number; text: string; jev: number | null; sim: number; simRank: number; jevRank: number };
type SearchRes = {
  ok: boolean; error?: string; moments: Moment[]; shortlist: Short[]; floor: number;
  retriever: "embedding" | "kie" | "bm25"; notes: string[]; jevApplied: boolean; mode?: "best-moments";
  stats: {
    durationSeconds: number; segments: number; windows: number; candidates: number; jevScored: number;
    transcriptCached: boolean; transcriptMs: number; retrieveMs: number; jevMs: number; totalMs: number;
  };
};
type CutClip = { ok: boolean; start: number; end: number; clipUrl?: string; error?: string; title?: string };
type Cost = { stt: number; jev: number; kie: number; compute: number; storage: number; requests: number; total: number };
type CutStats = {
  downloadMs: number; sourceCached: boolean; encodeMs: number; totalMs: number;
  clipSeconds: number; outBytes: number; width: number; height: number;
};
type LibClip = { url: string; at: number; start: number; end: number; title: string; sourceUrl: string; sourceName?: string; width: number; height: number };
type MyUpload = { url: string; name: string; bytes: number; at: number; durationSeconds: number | null; width: number | null; height: number | null };
type UploadInfo = { name: string; bytes: number; ms: number; durationSeconds: number | null; cost: Cost };
type Run = {
  id: string; at: number; kind: "upload" | "search" | "cut"; ok: boolean; error?: string;
  sourceUrl: string; sourceName?: string; durationSeconds?: number; bytes?: number; query?: string;
  clips?: number; ms: Record<string, number>; cost: Cost;
};
type Ledger = {
  status: { r2: boolean; ffmpeg: boolean; jev: boolean; jevReason: string | null; stt: string | null; authRequired: boolean };
  runs: Run[];
  totals: {
    runs: number; searches: number; cuts: number; uploads: number; clips: number; videoSeconds: number;
    uploadedBytes: number; spend: number; avgSearchMs: number | null; avgCutMs: number | null;
    avgClipCost: number | null; searchSpeedX: number | null;
  };
};

const PRESETS = [
  "a funny moment where people laugh",
  "a surprising reveal or plot twist",
  "a strong controversial opinion",
  "a personal story with a clear punchline",
  "a practical tip the viewer can use",
  "someone talking about money or getting rich",
];

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);
const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);
const ago = (t: number) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
/** Same-origin download (Content-Disposition: attachment) — a cross-origin
 *  <a download> to the R2 domain just opens the video instead of saving it. */
const downloadHref = (url: string, name: string) =>
  `/api/dev/jev/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;
const clipFileName = (title: string, i: number) =>
  `vello-${(title || `clip-${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `clip-${i + 1}`}.mp4`;
function triggerDownloads(files: { url: string; name: string }[]) {
  // Spaced out: browsers drop rapid back-to-back programmatic downloads.
  files.forEach((f, i) => setTimeout(() => {
    const a = document.createElement("a");
    a.href = downloadHref(f.url, f.name);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, i * 700));
}
const sumCost = (cs: (Cost | undefined)[]) => cs.reduce((n, c) => n + (c?.total ?? 0), 0);

function youtubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.split("/").filter(Boolean)[0] ?? null;
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      return u.searchParams.get("v") || u.pathname.match(/^\/(?:shorts|embed)\/([^/?]+)/)?.[1] || null;
    }
  } catch { /* not a URL */ }
  return null;
}

function googleDriveFileId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)drive\.google\.com$/.test(u.hostname)) return null;
    return u.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || u.searchParams.get("id");
  } catch { /* not a URL */ }
  return null;
}

function SourceTileMedia({ sourceUrl, videoUrl }: { sourceUrl: string; videoUrl: string }) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const youtubeId = youtubeVideoId(sourceUrl);
  if (youtubeId) {
    // The source thumbnail is instant and lightweight while the downloaded
    // full-resolution file remains available for the selected preview below.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`} alt="" className="size-full object-cover" />;
  }
  const driveId = googleDriveFileId(sourceUrl);
  if (driveId && !thumbnailFailed) {
    // Drive's thumbnail endpoint avoids fetching a multi-GB source just to
    // paint the picker. Private files fall through to the cached video below.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`https://drive.google.com/thumbnail?id=${driveId}&sz=w1000`} alt="" className="size-full object-cover" onError={() => setThumbnailFailed(true)} />;
  }
  return <video src={videoUrl} poster="/vellosquare.png" muted playsInline preload="metadata" className="size-full object-cover" />;
}

// Real stage timing isn't reported by the server (one round trip, no
// streaming) — this cycles through what's ACTUALLY happening at each phase,
// timed to roughly how long each step takes (see route.ts), so the wait
// reads as visible progress instead of a dead spinner. The live elapsed
// counter is the honest part: however long a given search/cut actually takes,
// that number is real.
const SEARCH_STAGES = ["Reading the transcript…", "Shortlisting candidate moments…", "Scoring with Jev…", "Ranking results…"];
const CUT_STAGES = ["Loading the source video…", "Cutting + burning the Vello watermark…", "Uploading clips to R2…"];

function useStagedStatus(active: boolean, stages: string[], stepMs = 1600) {
  const [i, setI] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t0 = performance.now();
    // Each StatusLine instance below is mounted fresh per run (keyed on a run
    // counter bumped by the caller), so this effect always starts from
    // useState's own 0 default here — never a stale value from a prior run.
    const stage = setInterval(() => setI((n) => Math.min(n + 1, stages.length - 1)), stepMs);
    const clock = setInterval(() => setElapsedMs(performance.now() - t0), 100);
    return () => { clearInterval(stage); clearInterval(clock); };
  }, [active, stages.length, stepMs]);
  return { text: stages[i], elapsedMs };
}

/** Pulsing dot + fading stage text + a live "N.Ns" — the actual animation. */
function StatusLine({ active, stages, tone = "white" }: { active: boolean; stages: string[]; tone?: "white" | "black" }) {
  const { text, elapsedMs } = useStagedStatus(active, stages);
  if (!active) return null;
  const dim = tone === "black" ? "text-black/50" : "text-white/50";
  const dot = tone === "black" ? "bg-black" : "bg-white";
  return (
    <div className={`flex items-center gap-2 text-[12.5px] ${dim}`}>
      <span className="relative flex size-1.5" aria-hidden>
        <span className={`absolute inset-0 animate-ping rounded-full ${dot} opacity-60`} />
        <span className={`relative size-1.5 rounded-full ${dot}`} />
      </span>
      <AnimatePresence mode="wait">
        <motion.span
          key={text}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.25 }}
        >
          {text}
        </motion.span>
      </AnimatePresence>
      <span className="tabular-nums opacity-70">{(elapsedMs / 1000).toFixed(1)}s</span>
    </div>
  );
}

/** A raw downloaded source can be a large file that was never re-encoded with
 *  `+faststart` — its index (moov atom) sits at the end, so a browser has to
 *  reach the tail before it can show/play anything at all, which for a
 *  multi-GB source can mean never, in practice. Confirmed directly (Chrome's
 *  own player, no app code involved, readyState stuck at 0 indefinitely) —
 *  this is a property of how the file is stored, not fixable from here.
 *  Clipping itself is unaffected: ffmpeg demuxes these fine server-side. This
 *  tries to play, and after a few seconds of nothing loading says so plainly
 *  instead of leaving a silently-stuck black box. */
function SourcePreview({ src }: { src: string }) {
  const [stuck, setStuck] = useState(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setStuck(true), 6000);
    return () => clearTimeout(t);
  }, [playing]);
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
      <div className="relative">
        <video
          src={src}
          controls
          preload="none"
          className="aspect-video w-full bg-black"
          onPlay={() => setPlaying(true)}
          onLoadedData={() => setStuck(false)}
        />
        {stuck && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/85 px-3 py-2 text-[11.5px] text-amber-200/90">
            This source isn&apos;t streamable in-browser (large file, not web-optimized) — clipping still works normally.{" "}
            <a href={src} target="_blank" rel="noreferrer" className="pointer-events-auto font-semibold underline">Open directly</a>
          </div>
        )}
      </div>
      <p className="truncate px-3 py-1.5 text-[12px] text-white/45">{src}</p>
    </div>
  );
}

export default function JevLabPage() {
  const { accessToken, profile, authenticated, login, getFreshToken, loading: authLoading } = useSupabaseAuth();
  // The whole page sits behind sign-in: uploads, clips and the library are per account.
  const needsSignIn = !authenticated;

  // ── Source: a video already in the system (agent downloads) or a pasted URL ──
  // Videos come from ALL of the user's agents at once (listByMints), not one
  // mint at a time — a single-agent lookup went quietly empty whenever the
  // default-selected agent happened to have no downloads, even though another
  // of the user's agents did. The dropdown below narrows the list; it no
  // longer gates what loads.
  const creatorWallets = useMemo(() => unionWalletAddresses(profile?.walletAddresses, null), [profile?.walletAddresses]);
  const myAgents = useQuery(api.influencers.listByCreators, creatorWallets.length ? { creatorWallets } : "skip") as
    | { mintAddress: string; name: string }[]
    | undefined;
  // Dev lab: no sign-in required to browse or search real videos. Always
  // fetched (same public data /agents shows with no auth) and used whenever
  // the signed-in user has no agents of their own to fall back on — this is
  // what was actually behind "doesn't show the video" while signed out.
  const publicAgents = useQuery(api.influencers.listAll) as { mintAddress: string; name: string }[] | undefined;
  const agents = myAgents?.length ? myAgents : publicAgents;
  const agentMints = useMemo(() => (agents ?? []).map((a) => a.mintAddress), [agents]);
  const allVideos = useQuery(api.downloadCache.listByMints, agentMints.length ? { mintAddresses: agentMints } : "skip") as
    | Doc<"downloadCache">[]
    | undefined;
  const [mintFilter, setMintFilter] = useState(""); // "" = all agents
  // Full-length source videos only — "segment"/"audio" downloads are trimmed
  // clips or audio-only, too short to search for a 20-60s moment in, and they
  // cluttered the picker next to the real long-form sources. listByMints
  // already sorts newest first; cap to the 10 most recent.
  const LATEST_N = 10;
  const playable = (allVideos ?? [])
    .filter((v) => v.mode !== "audio" && v.mode !== "segment" && (!mintFilter || v.mintAddress === mintFilter))
    .slice(0, LATEST_N);
  // A skipped signed-in query also returns undefined. The source query is the
  // only loading signal that matters, otherwise anonymous users spin forever
  // even after their public full-video list has arrived.
  const videosLoading = allVideos === undefined;
  const [sourceUrl, setSourceUrl] = useState("");
  // the link a download came from — the transcript cache is keyed on it
  const [originUrl, setOriginUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [ingest, setIngest] = useState<{ active: boolean; pct: number; speed?: string; label?: string }>({ active: false, pct: 0 });

  // ── Query + knobs ──
  const [query, setQuery] = useState(PRESETS[0]);
  const [maxClips, setMaxClips] = useState(5);
  const [minLen, setMinLen] = useState(20);
  const [maxLen, setMaxLen] = useState(60);
  const [useJev, setUseJev] = useState(true);
  const [vertical, setVertical] = useState(true);

  const [busy, setBusy] = useState<"" | "search" | "cut">("");
  // Bumped at the start of each phase so StatusLine remounts fresh (its stage
  // index / elapsed clock both start over) instead of carrying over whatever
  // the previous run left them at.
  const [searchRunId, setSearchRunId] = useState(0);
  const [cutRunId, setCutRunId] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<SearchRes | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [clips, setClips] = useState<CutClip[] | null>(null);
  const [cutStats, setCutStats] = useState<CutStats | null>(null);
  const [searchCost, setSearchCost] = useState<Cost | null>(null);
  const [cutCost, setCutCost] = useState<Cost | null>(null);

  // ── Own-video upload (→ R2 via /api/media/upload-jev) ──
  const [upload, setUpload] = useState<{ active: boolean; pct: number; name: string; loaded: number; total: number; t0: number } | null>(null);
  const [uploaded, setUploaded] = useState<UploadInfo | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [myUploads, setMyUploads] = useState<MyUpload[]>([]);
  const [myClips, setMyClips] = useState<LibClip[]>([]);
  // Display name of the selected source (upload file name), saved with its clips.
  const [sourceName, setSourceName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  // ── Ledger: status + all-time speed/cost, polled so the panel always has data ──
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const refreshLedger = useCallback(async () => {
    try {
      const r = await fetch("/api/dev/jev", { cache: "no-store" });
      const j = await r.json();
      if (j.ok) setLedger(j);
    } catch { /* panel keeps its last data */ }
  }, []);
  useEffect(() => {
    const first = setTimeout(refreshLedger, 0);
    const t = setInterval(refreshLedger, 15_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [refreshLedger]);
  // Wall clock of the whole upload → clips run, for the panel's live timer.
  const [runT0, setRunT0] = useState<number | null>(null);
  const [runEnd, setRunEnd] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const running = !!busy || !!upload?.active;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [running]);
  const [showShortlist, setShowShortlist] = useState(false);

  const downloadSource = async () => {
    const url = pasted.trim();
    if (!url || ingest.active) return;
    if (!authenticated) { login(); return; }
    setError(null);
    setIngest({ active: true, pct: 0, label: "Starting download" });
    try {
      const start = await fetch("/api/video/download-start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ sourceUrl: url, mode: "full" }),
      });
      const started = (await start.json().catch(() => ({}))) as { ok?: boolean; jobId?: string; error?: string };
      if (!start.ok || !started.ok || !started.jobId) throw new Error(started.error || `Download failed (HTTP ${start.status})`);

      const deadline = Date.now() + 30 * 60_000;
      for (;;) {
        if (Date.now() > deadline) throw new Error("Download timed out after 30 minutes");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const status = await fetch(`/api/video/download-status?jobId=${encodeURIComponent(started.jobId)}`, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        });
        const job = (await status.json().catch(() => ({}))) as {
          ok?: boolean; status?: string; url?: string; error?: string;
          progress?: { pct?: number; speed?: string };
        };
        if (!status.ok || !job.ok) throw new Error(job.error || `Status failed (HTTP ${status.status})`);
        if (job.status === "error") throw new Error(job.error || "Video download failed");
        if (job.status === "done" && job.url) {
          setSourceUrl(job.url);
          setOriginUrl(url);
          setPasted("");
          setRes(null);
          setClips(null);
          break;
        }
        setIngest({ active: true, pct: job.progress?.pct ?? 0, speed: job.progress?.speed, label: "Downloading video" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIngest({ active: false, pct: 0 });
    }
  };

  const post = async (payload: Record<string, unknown>) => {
    const r = await fetch("/api/dev/jev", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };

  // Cutting is auto-triggered right after a search finds moments — no second
  // click, no "found it, now go click Cut" gap. `src`/`moments` are passed in
  // explicitly rather than read off state, since this runs immediately after
  // setRes() in the same call and state hasn't committed yet.
  const cutMoments = async (src: string, moments: { start: number; end: number; title?: string }[], name = sourceName) => {
    if (!moments.length) return;
    setCutRunId((n) => n + 1);
    try {
      const j = (await post({ action: "cut", sourceUrl: src, sourceName: name || undefined, moments, vertical })) as { clips: CutClip[]; stats: CutStats; cost: Cost };
      const titleOf = new Map(moments.map((m) => [`${m.start}-${m.end}`, m.title ?? ""]));
      setClips(j.clips.map((c) => ({ ...c, title: titleOf.get(`${c.start}-${c.end}`) || undefined })));
      setCutStats(j.stats);
      setCutCost(j.cost);
      const fresh: LibClip[] = j.clips.filter((c) => c.ok && c.clipUrl).map((c) => ({
        url: c.clipUrl!, at: Date.now(), start: c.start, end: c.end,
        title: titleOf.get(`${c.start}-${c.end}`) || `Clip ${fmt(c.start)}–${fmt(c.end)}`,
        sourceUrl: src, sourceName: name || undefined, width: j.stats.width, height: j.stats.height,
      }));
      setMyClips((list) => [...fresh, ...list.filter((c) => !fresh.some((f) => f.url === c.url))]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // `src`/`origin` are passable so an upload can search the file it just
  // stored before the setSourceUrl() state update has committed.
  const runSearch = async (src = sourceUrl, origin = originUrl, keepClock = false, name = sourceName) => {
    if (!src || !query.trim() || busy) return;
    setBusy("search"); setError(null); setClips(null); setCutStats(null); setRes(null); setSearchCost(null); setCutCost(null);
    if (!keepClock) { setRunT0(Date.now()); setUploaded(null); }
    setRunEnd(null);
    setSearchRunId((n) => n + 1);
    try {
      const j = (await post({ action: "search", sourceUrl: src, sourceName: name || undefined, originUrl: origin, query, maxClips, minLen, maxLen, useJev })) as SearchRes & { cost: Cost };
      setRes(j);
      setSearchCost(j.cost);
      setSelected(new Set(j.moments.map((_, i) => i)));
      if (j.moments.length) {
        setBusy("cut");
        await cutMoments(src, j.moments.map((m) => ({ start: m.start, end: m.end, title: m.title })), name);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRes(null);
    }
    setRunEnd(Date.now());
    setBusy("");
    refreshLedger();
  };

  const loadMyUploads = useCallback(async () => {
    try {
      const r = await fetch("/api/dev/jev", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "uploads" }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok && Array.isArray(j.uploads)) setMyUploads(j.uploads);
    } catch { /* row just stays as it was */ }
    try {
      const r = await fetch("/api/dev/jev", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clips" }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok && Array.isArray(j.clips)) setMyClips(j.clips);
    } catch { /* library just stays as it was */ }
  }, []);
  useEffect(() => {
    if (needsSignIn) return;
    const t = setTimeout(loadMyUploads, 0);
    return () => clearTimeout(t);
  }, [needsSignIn, loadMyUploads]);

  /** Select a video and run the whole find → cut pipeline on it in one click. */
  const clipVideo = (url: string, origin: string, name: string) => {
    if (busy || upload?.active) return;
    setSourceUrl(url); setOriginUrl(origin); setSourceName(name);
    runSearch(url, origin, false, name);
  };

  const uploadFile = async (file: File) => {
    if (upload?.active || busy) return;
    setUploadError(null);
    if (!file.type.startsWith("video/")) { setUploadError(`${file.name} isn't a video file — pick an .mp4, .mov or .webm.`); return; }
    if (file.size > 2 * 1024 ** 3) { setUploadError("That file is over the 2 GB trial limit."); return; }
    if (needsSignIn) { setUploadError("Sign in to upload — the trial is free, it just needs an account."); login(); return; }
    setError(null); setRes(null); setClips(null); setCutStats(null); setSearchCost(null); setCutCost(null); setUploaded(null);
    const t0 = Date.now();
    setRunT0(t0); setRunEnd(null);
    setUpload({ active: true, pct: 0, name: file.name, loaded: 0, total: file.size, t0 });
    try {
      // The upload goes over XHR (fetch has no upload progress), and XHR skips
      // the app's fetch interceptor — the thing that attaches a fresh Privy
      // token + the wallet SIWS session and re-mints that session on a
      // siws_required 401. So first make one tiny call THROUGH the interceptor
      // (it signs in / re-mints as needed), then copy those credentials onto
      // the XHR. Without this, production answered every upload with a 401.
      const probe = await fetch("/api/dev/jev", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "auth" }),
      });
      if (!probe.ok) {
        const pj = (await probe.json().catch(() => ({}))) as { error?: string };
        throw new Error(probe.status === 401 ? "Sign in (and approve the wallet signature) to upload." : pj.error || `Upload check failed (HTTP ${probe.status})`);
      }
      const token = (await getFreshToken().catch(() => null)) ?? accessToken;
      const siws = getCurrentSiwsToken();

      const j = await new Promise<MyUpload & { ok: boolean; error?: string; ms: number; cost: Cost }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", `/api/media/upload-jev?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type)}`);
        xhr.setRequestHeader("Content-Type", file.type);
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        if (siws) xhr.setRequestHeader("X-Siws-Session", siws);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUpload((u) => u && { ...u, pct: (e.loaded / e.total) * 100, loaded: e.loaded });
        };
        xhr.onload = () => {
          let body: (MyUpload & { ok: boolean; error?: string; ms: number; cost: Cost }) | null = null;
          try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON (proxy error page) */ }
          if (body && body.ok) return resolve(body);
          reject(new Error(body?.error || (xhr.status === 413 ? "File too large for the server." : `Upload failed (HTTP ${xhr.status})`)));
        };
        xhr.onerror = () => reject(new Error("Upload failed — connection dropped. Check your network and try again."));
        xhr.ontimeout = () => reject(new Error("Upload timed out."));
        xhr.onabort = () => reject(new Error("Upload cancelled."));
        xhr.send(file);
      });
      setUploaded({ name: file.name, bytes: j.bytes, ms: Date.now() - t0, durationSeconds: j.durationSeconds, cost: j.cost });
      setMyUploads((list) => [{ url: j.url, name: j.name, bytes: j.bytes, at: j.at, durationSeconds: j.durationSeconds, width: j.width, height: j.height }, ...list.filter((u) => u.url !== j.url)]);
      setSourceUrl(j.url);
      setOriginUrl("");
      setSourceName(j.name);
      setUpload(null);
      // Straight into Jev — no extra click between "uploaded" and "clips".
      await runSearch(j.url, "", true, j.name);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
      setUpload(null);
      setRunEnd(Date.now());
      refreshLedger();
    }
  };

  // Re-cut just the checked ones — e.g. after deselecting a moment or
  // flipping the vertical/instant toggle post-search.
  const runCut = async () => {
    if (!res) return;
    const moments = res.moments.filter((_, i) => selected.has(i)).map((m) => ({ start: m.start, end: m.end, title: m.title }));
    if (!moments.length) return;
    setBusy("cut"); setError(null); setRunT0(Date.now()); setRunEnd(null);
    await cutMoments(sourceUrl, moments);
    setRunEnd(Date.now());
    setBusy("");
    refreshLedger();
  };

  const input = "rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[13px] text-white outline-none focus:border-white/30";

  if (authLoading || !authenticated) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#08080a] px-4 text-white">
        {authLoading ? (
          <Loader2 className="size-5 animate-spin text-white/40" />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-7 text-center"
          >
            <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-[#c6ff3d]/30 bg-[#c6ff3d]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#c6ff3d]">
              Free trial
            </div>
            <h1 className="text-[22px] font-semibold tracking-tight">Vello Clipping, powered by Jev</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-white/55">
              Turn a long video into ready-to-post clips in seconds. Sign in to upload your videos, generate clips and
              download them. Your uploads and clips are saved to your account.
            </p>
            <motion.button
              onClick={login}
              whileTap={{ scale: 0.97 }}
              className="mt-6 w-full rounded-full bg-[#c6ff3d] px-5 py-2.5 text-[14px] font-semibold text-black"
            >
              Sign in to start clipping
            </motion.button>
          </motion.div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#08080a] px-6 py-6 text-white">
      <LabTabs active="jev" />
      <div className="mx-auto grid max-w-[1400px] gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_340px] lg:pb-0">
      <div className="min-w-0">
        <header className="mb-6">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#c6ff3d]/30 bg-[#c6ff3d]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#c6ff3d]">
            Free trial
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Vello Clipping, powered by Jev</h1>
          <p className="mt-1.5 max-w-3xl text-[13.5px] leading-relaxed text-white/55">
            Upload a long video, tell us what you&apos;re looking for, and get ready-to-post clips in seconds. Jev reads the
            whole video, finds the moments that match, and skips the ones that don&apos;t, so you only get clips worth
            posting. Every clip is cut, framed for Shorts, Reels and TikTok, and marked Made by Vello. Free to try while
            we&apos;re in trial, and the panel on the right shows exactly how fast each run was and what it cost.
          </p>
        </header>

        {/* ── 1. Source ── */}
        <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-white/40">1 · Video</span>
            <select value={mintFilter} onChange={(e) => setMintFilter(e.target.value)} className={input}>
              <option value="">All agents</option>
              {agents?.map((a) => <option key={a.mintAddress} value={a.mintAddress}>{a.name || a.mintAddress.slice(0, 8)}</option>)}
            </select>
            <input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="…or paste a video URL"
              className={`${input} min-w-[240px] flex-1`}
            />
            <button
              disabled={!pasted.trim() || ingest.active}
              onClick={downloadSource}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white px-3 py-2 text-[12.5px] font-semibold text-black disabled:opacity-40"
            >
              {ingest.active && <Loader2 className="size-3.5 animate-spin" />}
              {authenticated ? "Download & use" : "Sign in to download"}
            </button>
          </div>
          {/* ── Upload your own ── */}
          <input
            ref={fileInput}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadFile(f); }}
          />
          <motion.div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) uploadFile(f); }}
            onClick={() => !upload?.active && fileInput.current?.click()}
            animate={{ scale: dragging ? 1.01 : 1 }}
            className={`mb-4 cursor-pointer rounded-xl border border-dashed p-4 transition-colors ${
              dragging ? "border-[#c6ff3d] bg-[#c6ff3d]/[0.06]" : "border-white/15 bg-white/[0.02] hover:border-white/35"
            }`}
          >
            {upload?.active ? (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-[12px] text-white/60">
                  <span className="flex min-w-0 items-center gap-2">
                    <Loader2 className="size-3.5 shrink-0 animate-spin" />
                    <span className="truncate">{upload.pct >= 100 ? "Storing on R2…" : `Uploading ${upload.name}`}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {Math.round(upload.pct)}% · {mb(upload.loaded)} / {mb(upload.total)}
                    {now > upload.t0 + 500 ? ` · ${((upload.loaded / 1e6) / ((now - upload.t0) / 1000)).toFixed(1)} MB/s` : ""}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <motion.div animate={{ width: `${upload.pct}%` }} className="h-full rounded-full bg-[#c6ff3d]" transition={{ duration: 0.25 }} />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#c6ff3d] text-black"><Upload className="size-4" /></span>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold">Upload your own video</div>
                  <div className="text-[12px] text-white/45">
                    Drop a file or click · stored on R2 · Jev starts clipping the moment it lands · max 2 GB
                  </div>
                </div>
              </div>
            )}
          </motion.div>
          <AnimatePresence>
            {uploadError && (
              <motion.div
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="-mt-2 mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[12.5px] text-red-200"
              >
                <span>{uploadError}</span>
                <button onClick={() => setUploadError(null)} className="shrink-0 text-red-200/70 hover:text-red-100">Dismiss</button>
              </motion.div>
            )}
          </AnimatePresence>

          {myUploads.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">Your uploads</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <AnimatePresence initial={false}>
                  {myUploads.map((u) => (
                    <motion.div
                      key={u.url}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={`overflow-hidden rounded-xl border transition-colors ${
                        sourceUrl === u.url ? "border-[#c6ff3d] bg-white/[0.04]" : "border-white/10 hover:border-white/30"
                      }`}
                    >
                      <button
                        onClick={() => { setSourceUrl(u.url); setOriginUrl(""); setSourceName(u.name); }}
                        className="block w-full text-left"
                        title="Preview this video"
                      >
                        <div className="relative aspect-video w-full overflow-hidden bg-[#111114]">
                          <video src={`${u.url}#t=0.5`} muted playsInline preload="metadata" className="size-full object-cover" />
                          {u.durationSeconds ? (
                            <span className="absolute bottom-1 right-1.5 rounded bg-black/60 px-1 py-px text-[10px] tabular-nums text-white/70">{fmt(u.durationSeconds)}</span>
                          ) : null}
                        </div>
                        <div className="truncate px-2 pt-1.5 text-[11.5px] text-white/70" title={u.name}>{u.name}</div>
                      </button>
                      <div className="p-2">
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          disabled={!!busy || !!upload?.active}
                          onClick={() => clipVideo(u.url, "", u.name)}
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#c6ff3d] px-2 py-1.5 text-[12px] font-semibold text-black disabled:opacity-40"
                        >
                          {busy && sourceUrl === u.url ? <Loader2 className="size-3.5 animate-spin" /> : <Scissors className="size-3.5" />}
                          {busy && sourceUrl === u.url ? (busy === "search" ? "Finding…" : "Cutting…") : "Clip this video"}
                        </motion.button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {ingest.active && (
            <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-white/55">
                <span>{ingest.label}</span>
                <span className="tabular-nums">{Math.round(ingest.pct)}%{ingest.speed ? ` · ${ingest.speed}` : ""}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <motion.div animate={{ width: `${ingest.pct}%` }} className="h-full rounded-full bg-emerald-400" transition={{ duration: 0.35 }} />
              </div>
            </div>
          )}
          {videosLoading ? (
            <p className="text-[13px] text-white/40">Loading videos…</p>
          ) : playable.length === 0 ? (
            <p className="text-[13px] text-white/40">
              {mintFilter ? "No downloaded videos for this agent." : "No downloaded videos yet."} Download one in Builder → Editor → Videos, or paste a URL.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {playable.map((v) => (
                <button
                  key={v._id}
                  onClick={() => { setSourceUrl(v.url); setOriginUrl(v.sourceUrl); setSourceName(""); }}
                  className={`overflow-hidden rounded-xl border text-left transition-colors ${
                    sourceUrl === v.url ? "border-white bg-white/[0.04]" : "border-white/10 hover:border-white/30"
                  }`}
                >
                  <div className="group relative aspect-video w-full overflow-hidden bg-[#111114]">
                    <SourceTileMedia sourceUrl={v.sourceUrl} videoUrl={v.url} />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
                    <span className="pointer-events-none absolute inset-0 grid place-items-center text-xl text-white/90 opacity-0 transition-opacity group-hover:opacity-100">▶</span>
                    {v.durationSeconds ? (
                      <span className="absolute bottom-1 right-1.5 rounded bg-black/60 px-1 py-px text-[10px] tabular-nums text-white/70">
                        {fmt(v.durationSeconds)}
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate px-2 py-1.5 text-[11.5px] text-white/60">
                    {v.sourceUrl.replace(/^https?:\/\/(www\.)?/, "")}
                  </div>
                </button>
              ))}
            </div>
          )}
          {sourceUrl && <SourcePreview key={sourceUrl} src={sourceUrl} />}
        </section>

        {/* ── 2. Query ── */}
        <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-white/40">2 · What should the clips show?</div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
            className={`${input} w-full text-[14px]`}
            placeholder="e.g. someone explaining how they lost money on crypto"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setQuery(p)}
                className={`rounded-full border px-3 py-1 text-[11.5px] ${query === p ? "border-white bg-white text-black" : "border-white/10 text-white/55 hover:text-white"}`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-[12.5px] text-white/65">
            <label className="flex items-center gap-2">Clips
              <input type="number" min={1} max={30} value={maxClips} onChange={(e) => setMaxClips(Number(e.target.value))} className={`${input} w-16`} />
            </label>
            <label className="flex items-center gap-2">Length
              <input type="number" min={5} max={120} value={minLen} onChange={(e) => setMinLen(Number(e.target.value))} className={`${input} w-16`} />
              –
              <input type="number" min={10} max={180} value={maxLen} onChange={(e) => setMaxLen(Number(e.target.value))} className={`${input} w-16`} />s
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={useJev} onChange={(e) => setUseJev(e.target.checked)} /> Jev rerank</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={vertical} onChange={(e) => setVertical(e.target.checked)} /> 9:16 crop</label>
            <span className="text-white/35">Vello watermark always on</span>
            <motion.button
              onClick={() => runSearch()}
              disabled={!sourceUrl || !query.trim() || !!busy}
              whileTap={{ scale: 0.97 }}
              className="ml-auto flex items-center gap-2 rounded-full bg-[#c6ff3d] px-5 py-2 text-[13px] font-semibold text-black disabled:opacity-40"
            >
              {busy && <span className="size-3 animate-spin rounded-full border-2 border-black/20 border-t-black" aria-hidden />}
              {!busy && <Scissors className="size-3.5" />}
              {busy === "search" ? "Finding moments…" : busy === "cut" ? "Cutting clips…" : "Generate clips"}
            </motion.button>
          </div>
          {!!busy && (
            <div className="mt-3 flex justify-end">
              <StatusLine key={`s${searchRunId}`} active={busy === "search"} stages={SEARCH_STAGES} />
              <StatusLine key={`c${cutRunId}`} active={busy === "cut"} stages={CUT_STAGES} />
            </div>
          )}
        </section>

        {error && <div className="mb-6 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-[13px] text-red-200">{error}</div>}

        {/* ── 3. Results ── */}
        <AnimatePresence>
        {res && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4"
          >
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-white/50">
              <span className="font-semibold uppercase tracking-wider text-white/40">3 · Moments</span>
              <span>transcript {ms(res.stats.transcriptMs)}{res.stats.transcriptCached ? " (cached)" : ""}</span>
              <span>{res.retriever} {ms(res.stats.retrieveMs)}</span>
              <span>Jev {res.jevApplied ? `${ms(res.stats.jevMs)} · ${res.stats.jevScored}/${res.stats.candidates} scored` : "off"}</span>
              <span>total {ms(res.stats.totalMs)}</span>
              <span>{res.stats.windows} windows from {res.stats.segments} segments</span>
            </div>
            {res.notes.map((n) => (
              <p key={n} className="mb-2 rounded-lg bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200/90">{n}</p>
            ))}

            {res.moments.length === 0 ? (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="py-6 text-center text-[13px] text-white/50"
              >
                {res.mode === "best-moments"
                  ? <>Kie found nothing worth clipping in this video.</>
                  : res.jevApplied
                  ? <>Nothing in this video matches (every candidate scored below Jev&apos;s {res.floor} floor).</>
                  : <>No window shares a word with the query (keyword fallback — Jev/embeddings off).</>}{" "}
                Try another query.
              </motion.p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {res.moments.map((m, i) => (
                  <motion.div
                    key={`${m.start}-${m.end}`}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    className={`rounded-xl border p-3 ${selected.has(i) ? "border-white/30" : "border-white/10 opacity-60"}`}
                  >
                    <div className="mb-2 flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(i)}
                        onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-semibold leading-snug">{m.title}</div>
                        <div className="mt-0.5 text-[11.5px] text-white/45">
                          {fmt(m.start)}–{fmt(m.end)} · {Math.round(m.end - m.start)}s · retriever #{m.simRank}
                        </div>
                      </div>
                      {m.jev !== null && (
                        <div className="text-right">
                          <div className="text-[15px] font-semibold tabular-nums text-emerald-300">{m.jev.toFixed(2)}</div>
                          <div className="text-[10px] uppercase tracking-wider text-white/35">Jev</div>
                        </div>
                      )}
                    </div>
                    <video src={`${sourceUrl}#t=${m.start},${m.end}`} controls preload="none" className="aspect-video w-full rounded-lg bg-black" />
                    <p className="mt-2 line-clamp-3 text-[12px] text-white/55">{m.text}</p>
                  </motion.div>
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={runCut}
                disabled={!selected.size || !!busy}
                className="rounded-full bg-white px-5 py-2 text-[13px] font-semibold text-black disabled:opacity-40"
              >
                {busy === "cut" ? `Cutting ${selected.size}…` : clips ? `Re-cut ${selected.size} selected` : `Cut ${selected.size} clip${selected.size === 1 ? "" : "s"}`}
              </button>
              <button onClick={() => setShowShortlist((v) => !v)} className="text-[12px] text-white/50 underline hover:text-white/80">
                {showShortlist ? "Hide" : "Show"} shortlist ({res.shortlist.length})
              </button>
            </div>

            {showShortlist && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="text-left text-white/40">
                    <tr><th className="py-1 pr-3">Jev #</th><th className="pr-3">Move</th><th className="pr-3">Jev</th><th className="pr-3">Sim</th><th className="pr-3">Time</th><th>Text</th></tr>
                  </thead>
                  <tbody>
                    {res.shortlist.map((s) => {
                      const move = s.simRank - s.jevRank;
                      const below = res.jevApplied && (s.jev === null || s.jev < res.floor);
                      return (
                        <tr key={`${s.start}-${s.end}`} className={`border-t border-white/5 ${below ? "opacity-40" : ""}`}>
                          <td className="py-1 pr-3 tabular-nums">{s.jevRank}</td>
                          <td className="pr-3 tabular-nums">{move > 0 ? `↑${move}` : move < 0 ? `↓${-move}` : "–"}</td>
                          <td className="pr-3 tabular-nums">{s.jev === null ? "–" : s.jev.toFixed(2)}</td>
                          <td className="pr-3 tabular-nums">{s.sim.toFixed(3)}</td>
                          <td className="whitespace-nowrap pr-3">{fmt(s.start)}–{fmt(s.end)}</td>
                          <td className="max-w-[520px] truncate text-white/55">{s.text}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </motion.section>
        )}
        </AnimatePresence>

        {/* ── 4. Cut clips ── */}
        <AnimatePresence>
        {(clips || busy === "cut") && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="mb-10 rounded-2xl border border-white/10 bg-white/[0.02] p-4"
          >
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-white/50">
              <span className="font-semibold uppercase tracking-wider text-white/40">4 · Clips</span>
              {!!clips?.some((c) => c.ok) && busy !== "cut" && (
                <button
                  onClick={() => triggerDownloads((clips ?? []).filter((c) => c.ok && c.clipUrl).map((c, i) => ({ url: c.clipUrl!, name: clipFileName(c.title ?? "", i) })))}
                  className="order-last ml-auto inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[12px] font-semibold text-black sm:order-none"
                >
                  <Download className="size-3.5" /> Download all
                </button>
              )}
              {cutStats && (
                <span>
                  source {cutStats.sourceCached ? "cached" : ms(cutStats.downloadMs)} · encode {ms(cutStats.encodeMs)} · total {ms(cutStats.totalMs)} · {cutStats.width}×{cutStats.height}
                  {cutCost ? ` · ${usd(cutCost.total)}` : ""}
                </span>
              )}
              <StatusLine key={`c2-${cutRunId}`} active={busy === "cut"} stages={CUT_STAGES} />
            </div>
            {!clips && busy === "cut" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {Array.from({ length: selected.size || maxClips }).map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.04 }}
                    className="aspect-[9/16] animate-pulse rounded-xl bg-white/[0.04]"
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {clips?.map((c, i) => (
                  <motion.div
                    key={`${c.start}-${c.end}`}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.06, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="rounded-xl border border-white/10 p-2"
                  >
                    {c.ok && c.clipUrl ? (
                      <>
                        <video src={c.clipUrl} controls preload="metadata" className={`w-full rounded-lg bg-black ${cutStats && cutStats.height > cutStats.width ? "aspect-[9/16]" : "aspect-video"}`} />
                        {c.title && <p className="mt-2 line-clamp-2 text-[12px] font-medium leading-snug text-white/80">{c.title}</p>}
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <span className="text-[11px] tabular-nums text-white/40">{fmt(c.start)}–{fmt(c.end)}</span>
                          <a href={downloadHref(c.clipUrl, clipFileName(c.title ?? "", i))} download className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11.5px] font-medium text-white hover:bg-white/20">
                            <Download className="size-3.5" /> Download
                          </a>
                        </div>
                      </>
                    ) : (
                      <p className="text-[12px] text-red-300">{fmt(c.start)}–{fmt(c.end)} failed: {c.error}</p>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </motion.section>
        )}
        </AnimatePresence>

        {/* ── Library: every clip this account has generated ── */}
        <section className="mb-10 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-white/40">Your clips</span>
            <span className="text-[12px] text-white/35">{myClips.length} saved</span>
            {myClips.length > 0 && (
              <button
                onClick={() => triggerDownloads(myClips.slice(0, 20).map((c, i) => ({ url: c.url, name: clipFileName(c.title, i) })))}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[12px] font-medium text-white/80 hover:border-white/35"
                title={myClips.length > 20 ? "Downloads the 20 newest" : undefined}
              >
                <Download className="size-3.5" /> Download {myClips.length > 20 ? "latest 20" : "all"}
              </button>
            )}
          </div>
          {myClips.length === 0 ? (
            <p className="text-[13px] text-white/40">No clips yet. Upload a video and press Clip this video, your clips will be saved here.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <AnimatePresence initial={false}>
                {myClips.map((c, i) => (
                  <motion.div
                    key={c.url}
                    layout
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.25 }}
                    className="rounded-xl border border-white/10 p-2"
                  >
                    <video src={c.url} controls preload="metadata" className={`w-full rounded-lg bg-black ${c.height > c.width ? "aspect-[9/16]" : "aspect-video"}`} />
                    <p className="mt-2 line-clamp-2 text-[12px] font-medium leading-snug text-white/80" title={c.title}>{c.title}</p>
                    <p className="truncate text-[10.5px] text-white/35" title={c.sourceName}>
                      {c.sourceName ? `${c.sourceName} · ` : ""}{fmt(c.start)}–{fmt(c.end)} · {ago(c.at)}
                    </p>
                    <a href={downloadHref(c.url, clipFileName(c.title, i))} download className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11.5px] font-medium text-white hover:bg-white/20">
                      <Download className="size-3.5" /> Download
                    </a>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>
      </div>

      <LedgerPanel
        ledger={ledger}
        running={running}
        elapsedMs={runT0 ? (runEnd ?? now) - runT0 : null}
        phase={upload?.active ? "Uploading" : busy === "search" ? "Jev searching" : busy === "cut" ? "Cutting clips" : null}
        uploaded={uploaded}
        search={res ? { ...res.stats, cost: searchCost, jevApplied: res.jevApplied, retriever: res.retriever, moments: res.moments.length } : null}
        cut={cutStats ? { ...cutStats, cost: cutCost, clips: clips?.filter((c) => c.ok).length ?? 0 } : null}
      />
      </div>
    </div>
  );
}

type SearchPart = SearchRes["stats"] & { cost: Cost | null; jevApplied: boolean; retriever: string; moments: number };
type CutPart = CutStats & { cost: Cost | null; clips: number };

function Dot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return <span className={`inline-block size-1.5 rounded-full ${ok ? "bg-[#c6ff3d]" : warn ? "bg-amber-400" : "bg-red-400"}`} aria-hidden />;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-white/35">{label}</div>
      <motion.div key={value} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} className="text-[15px] font-semibold tabular-nums">{value}</motion.div>
      {sub && <div className="text-[10.5px] text-white/40">{sub}</div>}
    </div>
  );
}

/** Always-visible speed + cost panel: this run's stage timings and cost, the
 *  server's dependency status, and the all-time ledger from R2. Sticky on
 *  desktop; on narrow screens the headline numbers pin to the bottom edge. */
function LedgerPanel({ ledger, running, elapsedMs, phase, uploaded, search, cut }: {
  ledger: Ledger | null; running: boolean; elapsedMs: number | null; phase: string | null;
  uploaded: UploadInfo | null; search: SearchPart | null; cut: CutPart | null;
}) {
  const runCost = sumCost([uploaded?.cost, search?.cost ?? undefined, cut?.cost ?? undefined]);
  const stages: { label: string; value: string; note?: string }[] = [];
  if (uploaded) stages.push({ label: "Upload → R2", value: ms(uploaded.ms), note: `${mb(uploaded.bytes)} · ${((uploaded.bytes / 1e6) / (uploaded.ms / 1000)).toFixed(1)} MB/s` });
  if (search) {
    stages.push({ label: "Transcript", value: search.transcriptCached ? "cached" : ms(search.transcriptMs), note: `${fmt(search.durationSeconds)} of video` });
    stages.push({ label: `Shortlist (${search.retriever})`, value: ms(search.retrieveMs), note: `${search.candidates}/${search.windows} windows` });
    stages.push({ label: "Jev judge", value: search.jevApplied ? ms(search.jevMs) : "off", note: search.jevApplied ? `${search.jevScored} scored · ${search.moments} picked` : undefined });
  }
  if (cut) stages.push({ label: "Cut + watermark", value: ms(cut.totalMs), note: `${cut.clips} clips · ${Math.round(cut.clipSeconds)}s out` });
  const t = ledger?.totals;
  const st = ledger?.status;

  return (
    <>
      <aside className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-white/40">Speed &amp; cost</span>
            {running && phase && (
              <span className="flex items-center gap-1.5 text-[11px] text-[#c6ff3d]">
                <span className="relative flex size-1.5"><span className="absolute inset-0 animate-ping rounded-full bg-[#c6ff3d] opacity-60" /><span className="relative size-1.5 rounded-full bg-[#c6ff3d]" /></span>
                {phase}
              </span>
            )}
          </div>

          {/* This run */}
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Stat label={running ? "Elapsed" : "Time to clips"} value={elapsedMs !== null ? `${(elapsedMs / 1000).toFixed(1)}s` : "—"} sub={search ? `${(search.durationSeconds / Math.max(0.001, search.totalMs / 1000)).toFixed(0)}× realtime search` : undefined} />
            <Stat label="This run cost" value={elapsedMs !== null ? usd(runCost) : "—"} sub={cut?.clips ? `${usd(runCost / cut.clips)} / clip` : undefined} />
          </div>
          <AnimatePresence initial={false}>
            {stages.length > 0 && (
              <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-3 space-y-1 overflow-hidden">
                {stages.map((s, i) => (
                  <motion.li
                    key={s.label}
                    initial={{ opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="flex items-baseline justify-between gap-2 border-b border-white/5 pb-1 text-[12px]"
                  >
                    <span className="text-white/55">{s.label}{s.note && <span className="block text-[10.5px] text-white/30">{s.note}</span>}</span>
                    <span className="shrink-0 font-medium tabular-nums">{s.value}</span>
                  </motion.li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
          {(search?.cost || cut?.cost || uploaded) && (
            <div className="mb-3 rounded-lg bg-white/[0.03] px-2.5 py-2 text-[11px] text-white/50">
              {([
                ["Transcription", search?.cost?.stt ?? 0],
                ["Jev", search?.cost?.jev ?? 0],
                ["Kie LLM", search?.cost?.kie ?? 0],
                ["Encode CPU", cut?.cost?.compute ?? 0],
                ["R2 storage /mo", (uploaded?.cost.storage ?? 0) + (cut?.cost?.storage ?? 0)],
                ["R2 requests", (uploaded?.cost.requests ?? 0) + (cut?.cost?.requests ?? 0)],
              ] as const).map(([k, v]) => (
                <div key={k} className="flex justify-between"><span>{k}</span><span className="tabular-nums">{usd(v)}</span></div>
              ))}
            </div>
          )}

          {/* Service status */}
          <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px] text-white/60">
            <span className="flex items-center gap-1.5"><Dot ok={!!st?.r2} /> R2 storage</span>
            <span className="flex items-center gap-1.5" title={st?.jevReason ?? undefined}><Dot ok={!!st?.jev} /> Jev judge</span>
            <span className="flex items-center gap-1.5"><Dot ok={!!st?.stt} /> STT {st?.stt ?? "off"}</span>
            <span className="flex items-center gap-1.5"><Dot ok={!!st?.ffmpeg} /> ffmpeg</span>
            <span className="col-span-2 flex items-center gap-1.5"><Dot ok warn={st?.authRequired} /> {st?.authRequired ? "Sign-in required" : "Open dev lab (no sign-in)"}</span>
            {st && !st.jev && st.jevReason && <span className="col-span-2 text-[10.5px] text-amber-200/80">Jev: {st.jevReason}</span>}
          </div>

          {/* All-time */}
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-white/35">All time{t ? ` · ${t.runs} runs` : ""}</div>
          {t ? (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <Stat label="Clips made" value={String(t.clips)} sub={`${t.uploads} uploads · ${mb(t.uploadedBytes)}`} />
              <Stat label="Total spend" value={usd(t.spend)} sub={t.avgClipCost !== null ? `${usd(t.avgClipCost)} / clip` : undefined} />
              <Stat label="Avg search" value={t.avgSearchMs !== null ? ms(t.avgSearchMs) : "—"} sub={t.searchSpeedX ? `${t.searchSpeedX.toFixed(0)}× realtime` : undefined} />
              <Stat label="Avg cut batch" value={t.avgCutMs !== null ? ms(t.avgCutMs) : "—"} sub={`${Math.round(t.videoSeconds / 60)} min searched`} />
            </div>
          ) : (
            <p className="mb-3 text-[12px] text-white/35">Loading ledger…</p>
          )}
          {!!ledger?.runs.length && (
            <ul className="space-y-1">
              {ledger.runs.slice(0, 12).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="flex min-w-0 items-center gap-1.5 text-white/55">
                    <Dot ok={r.ok} />
                    <span className="w-11 shrink-0 text-white/75">{r.kind}</span>
                    <span className="truncate" title={r.error ?? r.query ?? r.sourceName}>{r.ok ? (r.query ?? r.sourceName ?? (r.clips !== undefined ? `${r.clips} clips` : "")) : r.error}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-white/40">{ms(r.ms.total ?? 0)} · {usd(r.cost.total)} · {ago(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[10px] leading-snug text-white/30">
            Costs are estimates: measured usage × provider list rates (override with JEV_COST_* env). Transcripts are paid once per video, then cached.
          </p>
        </div>
      </aside>

      {/* Narrow screens: headline numbers stay pinned while scrolling. */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-white/10 bg-[#08080a]/95 px-4 py-2.5 text-[12px] backdrop-blur lg:hidden">
        <span className="flex items-center gap-1.5 text-white/60">
          {running && <span className="size-1.5 animate-pulse rounded-full bg-[#c6ff3d]" />}
          {phase ?? (elapsedMs !== null ? "Last run" : "Idle")}
        </span>
        <span className="tabular-nums">{elapsedMs !== null ? `${(elapsedMs / 1000).toFixed(1)}s` : "—"} · {elapsedMs !== null ? usd(runCost) : "—"}</span>
        <span className="tabular-nums text-white/45">{t ? `${t.clips} clips · ${usd(t.spend)} total` : ""}</span>
      </div>
    </>
  );
}
