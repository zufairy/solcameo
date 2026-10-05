/**
 * Layer 3 helper — ask the project's multimodal LLM (KIE / Gemini 3 Flash, the
 * primary web LLM path per repo memory; one provider/credential = KIE_API_KEY)
 * for a STRUCTURED content verdict on a rendered clip, given sampled frames +
 * a transcript window.
 *
 * DESIGN-LEVEL skeleton. The exact KIE request shape is left as a single,
 * clearly-marked TODO so the live wiring lives in ONE place — the rest (schema,
 * validation, retry, parse-failure-as-infra-error) is implemented here so the
 * spec can depend on a stable contract. NOT imported by the default e2e run.
 */
import { z } from "zod";

/** Strict JSON-schema the model must return — makes assertions binary. */
export const VisionVerdictSchema = z.object({
  captionsPresent: z.boolean(),
  captionText: z.string().nullable(),
  captionSyncedToSpeech: z.boolean(),
  bgGameplay: z.boolean(),
  sfxNearBeat: z.boolean(),
  confidence: z.number().min(0).max(1),
  notes: z.string(),
});
export type VisionVerdict = z.infer<typeof VisionVerdictSchema>;

export interface VisionInput {
  /** Sampled frames as base64 data URLs (from extractFrames). */
  frameDataUrls: string[];
  /** Short transcript window (from the existing KIE transcription path). */
  transcript: string;
  /** Optional deterministic audio-energy peak (dBFS) near the hook beat; when
   *  provided, prefer it over the model for the soft SFX signal. */
  audioPeakDbfsNearBeat?: number;
}

const SYSTEM_INSTRUCTION = [
  "You verify the CONTENT of a short-form vertical video clip from sampled frames",
  "and a transcript. Return ONLY JSON matching the schema. Be conservative:",
  "set a field true only when the evidence is clear. captionSyncedToSpeech is true",
  "only if on-screen caption text matches the transcript window. Use low confidence",
  "when frames are ambiguous.",
].join(" ");

/**
 * Call the multimodal model and return a validated verdict. Throws a tagged
 * `VisionInfraError` on network/parse failure so the spec treats it as INFRA
 * (skip), never a content failure.
 */
export class VisionInfraError extends Error {}

/**
 * ── TODO(live wiring): the ONLY place that talks to KIE ──────────────────────
 * POST the frames (as image parts / data URLs) + transcript + SYSTEM_INSTRUCTION
 * + a response_format:json_schema to the KIE Gemini 3 Flash multimodal endpoint
 * with `temperature`. Mirror the request shape already used by the clip-pipeline
 * transcription call (same base URL + auth header `Authorization: Bearer ...`).
 * Return the model's raw JSON text.
 *
 * Until wired, throw INFRA so a stray RUN_VISION=1 run SKIPS rather than
 * reporting a false content failure.
 */
async function callKieVisionRawJson(
  _args: { apiKey: string; input: VisionInput; temperature: number; system: string },
): Promise<string> {
  throw new VisionInfraError("KIE vision call not wired yet (design skeleton)");
}

export async function getVisionVerdict(
  input: VisionInput,
  opts: { apiKey?: string; retries?: number; temperature?: number } = {},
): Promise<VisionVerdict> {
  const apiKey = opts.apiKey ?? process.env.KIE_API_KEY;
  if (!apiKey) throw new VisionInfraError("KIE_API_KEY not set");
  const retries = opts.retries ?? 1;
  const temperature = opts.temperature ?? 0;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const raw = await callKieVisionRawJson({
        apiKey, input, temperature, system: SYSTEM_INSTRUCTION,
      });
      const parsed = VisionVerdictSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw new VisionInfraError("model returned non-schema JSON");
      const verdict = parsed.data;
      // Prefer the deterministic audio heuristic for the weak SFX signal.
      if (typeof input.audioPeakDbfsNearBeat === "number") {
        verdict.sfxNearBeat = input.audioPeakDbfsNearBeat > -20;
      }
      return verdict;
    } catch (err) {
      lastErr = err;
      // "not wired" is a hard design-stage INFRA stop — don't burn retries.
      if (err instanceof VisionInfraError && /not wired/.test(err.message)) throw err;
    }
  }
  throw new VisionInfraError(`vision call failed: ${String(lastErr)}`);
}
