// /dev/jev speed + cost ledger. Every upload / search / cut records one run with
// its stage timings and an itemised cost estimate; the log lives in R2 (one JSON
// object, newest first) so the lab's status panel shows real history on any
// page load, across restarts and deploys — not just the current tab's session.
//
// Costs are ESTIMATES from per-unit rates (provider list prices, overridable
// with env) × what the run actually consumed — no provider exposes a per-call
// bill we could read back. Set the env rates to your invoiced prices.
import { getR2Object, putR2Object, r2Configured } from "@/lib/server/videoStorage";

const envRate = (name: string, d: number) => {
  const raw = process.env[name];
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= 0 ? n : d;
};

export const RATES = {
  /** ElevenLabs Scribe, $ per hour of audio. */
  sttElevenPerHour: envRate("JEV_COST_STT_PER_HOUR", 0.4),
  /** Kie Gemini STT fallback, $ per hour of audio. */
  sttKiePerHour: envRate("JEV_COST_STT_KIE_PER_HOUR", 0.1),
  /** Typesafe Jev, $ per judged (query, caption) pair. */
  jevPerCall: envRate("JEV_COST_PER_CALL", 0.001),
  /** One Kie LLM call (best-moments pick / rerank). */
  kiePerCall: envRate("JEV_COST_KIE_PER_CALL", 0.003),
  /** Server CPU, $ per vCPU-hour (Railway ≈ $20/vCPU-month). */
  cpuPerHour: envRate("JEV_COST_CPU_PER_HOUR", 0.028),
  /** R2 storage, $ per GB-month (zero egress). */
  r2PerGbMonth: 0.015,
  /** R2 class-A op (PUT), $ each. */
  r2PerPut: 4.5 / 1_000_000,
};

export type JevCost = { stt: number; jev: number; kie: number; compute: number; storage: number; requests: number; total: number };
type CostParts = Omit<JevCost, "total">;

export function costOf(parts: Partial<CostParts>): JevCost {
  const c: CostParts = { stt: 0, jev: 0, kie: 0, compute: 0, storage: 0, requests: 0, ...parts };
  return { ...c, total: c.stt + c.jev + c.kie + c.compute + c.storage + c.requests };
}

export const sttCost = (durationSeconds: number, provider: string | undefined) =>
  (durationSeconds / 3600) * (provider === "kie-gemini" ? RATES.sttKiePerHour : RATES.sttElevenPerHour);
export const cpuCost = (cpuMs: number) => (cpuMs / 3_600_000) * RATES.cpuPerHour;
/** One month of R2 storage for `bytes`. */
export const storageCost = (bytes: number) => (bytes / 1e9) * RATES.r2PerGbMonth;

export type JevRun = {
  id: string;
  at: number;
  kind: "upload" | "search" | "cut";
  ok: boolean;
  error?: string;
  sourceUrl: string;
  sourceName?: string;
  durationSeconds?: number;
  bytes?: number;
  query?: string;
  mode?: string;
  retriever?: string;
  provider?: string;
  transcriptCached?: boolean;
  clips?: number;
  jevCalls?: number;
  kieCalls?: number;
  ms: Record<string, number>;
  cost: JevCost;
};

const KEY = "jev/metrics/runs.json";
const KEEP = 300;
let runs: JevRun[] | null = null;
let loading: Promise<JevRun[]> | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<JevRun[]> {
  if (runs) return runs;
  loading ??= (async () => {
    try {
      const raw = await getR2Object(KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      runs = Array.isArray(parsed) ? (parsed as JevRun[]) : [];
    } catch (e) {
      console.warn(`[jev-metrics] load failed, starting empty: ${e instanceof Error ? e.message : e}`);
      runs = [];
    }
    return runs;
  })();
  return loading;
}

/** Record a run. Never throws — metrics must not fail the request they describe. */
export async function recordRun(run: Omit<JevRun, "id" | "at">): Promise<JevRun> {
  const full: JevRun = { ...run, id: crypto.randomUUID(), at: Date.now() };
  try {
    const list = await load();
    list.unshift(full);
    if (list.length > KEEP) list.length = KEEP;
    if (r2Configured()) {
      const snapshot = JSON.stringify(list);
      writeChain = writeChain
        .then(() => putR2Object(KEY, snapshot))
        .catch((e) => console.warn(`[jev-metrics] persist failed: ${e instanceof Error ? e.message : e}`));
      await writeChain;
    }
  } catch (e) {
    console.warn(`[jev-metrics] record failed: ${e instanceof Error ? e.message : e}`);
  }
  return full;
}

export type JevTotals = {
  runs: number; searches: number; cuts: number; uploads: number; clips: number;
  videoSeconds: number; uploadedBytes: number; spend: number;
  avgSearchMs: number | null; avgCutMs: number | null; avgClipCost: number | null;
  /** seconds of source video searched per wall-clock second of search */
  searchSpeedX: number | null;
  byPart: CostParts;
};

export async function listRuns(limit = 40): Promise<{ runs: JevRun[]; totals: JevTotals }> {
  const all = await load();
  const ok = all.filter((r) => r.ok);
  const of = (k: JevRun["kind"]) => ok.filter((r) => r.kind === k);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const searches = of("search");
  const cuts = of("cut");
  const clips = cuts.reduce((n, r) => n + (r.clips ?? 0), 0);
  const byPart: CostParts = { stt: 0, jev: 0, kie: 0, compute: 0, storage: 0, requests: 0 };
  for (const r of all) for (const k of Object.keys(byPart) as (keyof CostParts)[]) byPart[k] += r.cost?.[k] ?? 0;
  const spend = all.reduce((n, r) => n + (r.cost?.total ?? 0), 0);
  const searchMs = searches.reduce((n, r) => n + (r.ms.total ?? 0), 0);
  const searchedSec = searches.reduce((n, r) => n + (r.durationSeconds ?? 0), 0);
  return {
    runs: all.slice(0, limit),
    totals: {
      runs: all.length, searches: searches.length, cuts: cuts.length, uploads: of("upload").length, clips,
      videoSeconds: searchedSec,
      uploadedBytes: of("upload").reduce((n, r) => n + (r.bytes ?? 0), 0),
      spend,
      avgSearchMs: avg(searches.map((r) => r.ms.total ?? 0)),
      avgCutMs: avg(cuts.map((r) => r.ms.total ?? 0)),
      avgClipCost: clips ? spend / clips : null,
      searchSpeedX: searchMs ? searchedSec / (searchMs / 1000) : null,
      byPart,
    },
  };
}

// ── Per-user upload index: the lab's "Your uploads" row ──
// One small JSON per user in R2, newest first — survives reloads and devices,
// and never lists anyone else's videos.

export type JevUpload = {
  url: string; name: string; bytes: number; at: number;
  durationSeconds: number | null; width: number | null; height: number | null;
};

const UPLOADS_KEEP = 50;
const uploadsKey = (userId: string) => `jev/uploads-index/${userId.replace(/[^a-zA-Z0-9_-]+/g, "_")}.json`;
const uploadWrites = new Map<string, Promise<void>>();

export async function listUploads(userId: string): Promise<JevUpload[]> {
  try {
    const raw = await getR2Object(uploadsKey(userId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as JevUpload[]) : [];
  } catch (e) {
    console.warn(`[jev-uploads] list failed: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

/** Never throws — the upload itself already succeeded. */
export async function addUpload(userId: string, up: JevUpload): Promise<void> {
  if (!r2Configured()) return;
  const prev = uploadWrites.get(userId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const list = (await listUploads(userId)).filter((u) => u.url !== up.url);
    list.unshift(up);
    await putR2Object(uploadsKey(userId), JSON.stringify(list.slice(0, UPLOADS_KEEP)));
  }).catch((e) => console.warn(`[jev-uploads] add failed: ${e instanceof Error ? e.message : e}`));
  uploadWrites.set(userId, next);
  await next;
}

// ── Per-user clip library: the lab's "Your clips" ──

export type JevClip = {
  url: string; at: number; start: number; end: number; title: string;
  sourceUrl: string; sourceName?: string; width: number; height: number;
};

const CLIPS_KEEP = 200;
const clipsKey = (userId: string) => `jev/clips-index/${userId.replace(/[^a-zA-Z0-9_-]+/g, "_")}.json`;
const clipWrites = new Map<string, Promise<void>>();

export async function listClips(userId: string): Promise<JevClip[]> {
  try {
    const raw = await getR2Object(clipsKey(userId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as JevClip[]) : [];
  } catch (e) {
    console.warn(`[jev-clips] list failed: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

/** Never throws — the clips are already rendered and stored. */
export async function addClips(userId: string, clips: JevClip[]): Promise<void> {
  if (!r2Configured() || !clips.length) return;
  const prev = clipWrites.get(userId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const fresh = new Set(clips.map((c) => c.url));
    const list = [...clips, ...(await listClips(userId)).filter((c) => !fresh.has(c.url))];
    await putR2Object(clipsKey(userId), JSON.stringify(list.slice(0, CLIPS_KEEP)));
  }).catch((e) => console.warn(`[jev-clips] add failed: ${e instanceof Error ? e.message : e}`));
  clipWrites.set(userId, next);
  await next;
}
