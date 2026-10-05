/**
 * Offline accuracy check for lib/server/speakerTrack.ts against a diarized
 * transcript (ElevenLabs Scribe `diarize=true` JSON as ground truth).
 *
 * Usage (from apps/web):
 *   npx tsx scripts/eval-speaker-track.ts <video> <diarized.json> [startS=0] [durS=60] [--debug]
 *
 * Scores only frames with 2+ faces where exactly one diarized speaker is
 * talking (single-face frames are trivially right). Each diarized speaker is
 * located by the mean x of the face that shows the most mouth evidence while
 * they talk; a pick is correct when it's the face nearest that speaker's spot.
 * The old largest-face pick is graded on the identical ground truth.
 */
import { mkdtemp, readdir, rm, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectFaces } from "../lib/server/centerface";
import { analyzeSpeakers, readMonoPcm } from "../lib/server/speakerTrack";
import { resolveFfmpegPath } from "../lib/server/ffmpegBin";

const FPS = 10;
const ff = resolveFfmpegPath()!;
const run = (args: string[]) => new Promise<void>((res, rej) => {
  const p = spawn(ff, args, { stdio: ["ignore", "ignore", "pipe"] });
  let e = ""; p.stderr.on("data", (d) => { e += d; });
  p.on("close", (c) => (c === 0 ? res() : rej(new Error(e.slice(-300)))));
});

async function main() {
  const [video, gtPath, s = "0", d = "60"] = process.argv.slice(2);
  const debug = process.argv.includes("--debug");
  const startS = Number(s), durS = Number(d);
  const gt = JSON.parse(await readFile(gtPath, "utf8")) as { words: { type: string; start: number; end: number; speaker_id?: string }[] };
  const words = gt.words.filter((w) => w.type === "word" && w.speaker_id);
  const speakerAt = (t: number): string | null => {
    const hits = new Set(words.filter((w) => w.start - 0.05 <= t && t <= w.end + 0.05).map((w) => w.speaker_id!));
    return hits.size === 1 ? [...hits][0] : null;
  };

  const dir = await mkdtemp(join(tmpdir(), "spk-eval-"));
  try {
    const t0 = Date.now();
    await run(["-y", "-ss", String(startS), "-i", video, "-t", String(durS), "-vf", `fps=${FPS},scale=${process.env.SCALE ?? 640}:-2`, join(dir, "f%05d.jpg")]);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg")).sort();
    const frames = await Promise.all(files.map(async (f, i) => ({ t: i / FPS, path: join(dir, f), faces: await detectFaces(join(dir, f)) })));
    const t1 = Date.now();
    const pcm = await readMonoPcm(run, video, join(dir, "a.f32"), durS, startS);
    const out = await analyzeSpeakers(frames, pcm, FPS);
    const t2 = Date.now();

    // Where does each GT speaker sit? Mean x of the most-evidenced face while they talk.
    const spot = new Map<string, { sum: number; n: number }>();
    out.forEach((fr) => {
      const g = speakerAt(startS + fr.t);
      if (!g || fr.faces.length < 2) return;
      const top = fr.faces.slice().sort((a, b) => b.speaking - a.speaking)[0];
      const a = spot.get(g) ?? { sum: 0, n: 0 }; a.sum += top.cx; a.n++; spot.set(g, a);
    });
    // GT_X="speaker_0=0.3,speaker_1=0.7" pins speaker spots from a human look at
    // the footage (unbiased); otherwise they're inferred from the evidence.
    const pinned = (process.env.GT_X ?? "").split(",").filter(Boolean).map((kv) => kv.split("=") as [string, string]);
    const gtCx = pinned.length
      ? new Map(pinned.map(([k, v]) => [k, Number(v)]))
      : new Map([...spot].map(([k, v]) => [k, v.sum / v.n]));
    const isRight = (cx: number, g: string) => {
      const mine = gtCx.get(g);
      if (mine === undefined) return false;
      return [...gtCx].filter(([k]) => k !== g).every(([, o]) => Math.abs(cx - mine) < Math.abs(cx - o));
    };

    let n = 0, oldOk = 0, newOk = 0, rawOk = 0, evOk = 0;
    out.forEach((fr) => {
      if (fr.faces.filter((f) => !f.ghost).length < 2 || fr.speakerId === null) return;
      const g = speakerAt(startS + fr.t);
      if (!g) return;
      n++;
      const largest = fr.faces.filter((f) => !f.ghost).sort((a, b) => b.w - a.w)[0];
      const picked = fr.faces.find((f) => f.trackId === fr.speakerId)!;
      if (isRight(largest.cx, g)) oldOk++;
      if (isRight(picked.cx, g)) newOk++;
      const real = fr.faces.filter((f) => f.motion !== undefined);
      if (real.length >= 2 && isRight(real.slice().sort((a, b) => b.motion! - a.motion!)[0].cx, g)) rawOk++;
      if (isRight(fr.faces.slice().sort((a, b) => b.speaking - a.speaking)[0].cx, g)) evOk++;
    });
    // Raw signal quality: AUC of per-frame mouth motion, speaker face vs listener
    // face (2-face frames with a known speaker). 0.5 = no signal, 1 = perfect.
    const pos: number[] = [], neg: number[] = [];
    out.forEach((fr) => {
      const g = speakerAt(startS + fr.t);
      if (!g || fr.faces.length < 2) return;
      fr.faces.forEach((f) => { if (f.motion === undefined) return; (isRight(f.cx, g) ? pos : neg).push(f.motion); });
    });
    let auc = 0;
    for (const p of pos) for (const q of neg) auc += p > q ? 1 : p === q ? 0.5 : 0;
    auc = pos.length && neg.length ? auc / (pos.length * neg.length) : NaN;
    console.log(JSON.stringify({
      mouthAUC: +auc.toFixed(3),
      window: `${startS}-${startS + durS}s`, frames: frames.length, scoredFrames: n,
      speakersAtX: Object.fromEntries([...gtCx].map(([k, v]) => [k, +v.toFixed(2)])),
      largestFaceAccuracy: n ? +(oldOk / n).toFixed(3) : null,
      speakerTrackAccuracy: n ? +(newOk / n).toFixed(3) : null,
      rawArgmaxAccuracy: n ? +(rawOk / n).toFixed(3) : null,
      evidenceArgmaxAccuracy: n ? +(evOk / n).toFixed(3) : null,
      detectMs: t1 - t0, analyzeMs: t2 - t1,
    }));
    if (debug) {
      out.filter((_, i) => i % 5 === 0).forEach((fr) => {
        const g = speakerAt(startS + fr.t);
        console.log(`${(startS + fr.t).toFixed(1).padStart(6)} v=${fr.voiced ? 1 : 0} gt=${g ?? "-"} pick=${fr.speakerId} `
          + fr.faces.map((f) => `#${f.trackId}@${f.cx.toFixed(2)} w${f.w.toFixed(2)} e${(f.speaking * 1000).toFixed(1)}`).join(" | "));
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
