export interface EngineAdapter {
  id: string;
  /** Snap/clamp a requested clip length to what this engine accepts. */
  encodeDuration(seconds: number): number | string;
  promptDialect: "veo" | "grok" | "generic";
  supportsNativeExtend: boolean;
}

function clamp(seconds: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(seconds)));
}
/**
 * Round UP to the first of `allowed` (ascending) that is >= seconds, falling
 * back to the last allowed value when none qualify. Mirrors the real Veo
 * pipeline's `validDurations.find(d => d >= durationSeconds) ?? fallback`
 * (kie-video-pipeline.ts) — NOT nearest-snap.
 */
function roundUpTo(seconds: number, allowed: number[]): number {
  return allowed.find((d) => d >= seconds) ?? allowed[allowed.length - 1];
}
/**
 * Reduce over `allowed` seeded at `seed` (not allowed[0]), picking the
 * candidate with the smallest absolute distance to `seconds`; ties keep the
 * earlier-seeded/current value. Mirrors the real Gemini pipeline's
 * snapGeminiDuration (kie-video-pipeline.ts) — seeding at the HIGH end means
 * ties and the upper region favor the higher value.
 */
function snapSeeded(seconds: number, allowed: number[], seed: number): number {
  return allowed.reduce((best, v) => (Math.abs(v - seconds) < Math.abs(best - seconds) ? v : best), seed);
}

const VEO: EngineAdapter = {
  id: "veo",
  encodeDuration: (s) => roundUpTo(s, [4, 6, 8]),
  promptDialect: "veo",
  supportsNativeExtend: true,
};
const GROK: EngineAdapter = {
  id: "grok",
  encodeDuration: (s) => clamp(s, 6, 30),
  promptDialect: "grok",
  supportsNativeExtend: true,
};
const SEEDANCE: EngineAdapter = {
  id: "seedance",
  encodeDuration: (s) => clamp(s, 5, 15),
  promptDialect: "generic",
  supportsNativeExtend: false,
};
const GEMINI: EngineAdapter = {
  id: "gemini",
  encodeDuration: (s) => snapSeeded(s, [4, 6, 8, 10], 10),
  promptDialect: "generic",
  supportsNativeExtend: false,
};
const KLING: EngineAdapter = {
  id: "kling",
  encodeDuration: (s) => clamp(s, 5, 10),
  promptDialect: "generic",
  supportsNativeExtend: false,
};
const GENERIC: EngineAdapter = {
  id: "generic",
  encodeDuration: (s) => clamp(s, 4, 10),
  promptDialect: "generic",
  supportsNativeExtend: false,
};

export function getEngineAdapter(engine: string): EngineAdapter {
  const e = (engine ?? "").toLowerCase();
  if (/veo/.test(e)) return VEO;
  if (/grok/.test(e)) return GROK;
  if (/seedance/.test(e)) return SEEDANCE;
  if (/gemini/.test(e)) return GEMINI;
  if (/kling/.test(e)) return KLING;
  return GENERIC;
}
