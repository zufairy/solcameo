/** Fills a format's engine-neutral template from the show bible + the day's
 *  topic. Every {placeholder} MUST resolve — a leaked brace is a bug the tests
 *  catch. Engine-dialect rewriting happens after this, in enginePromptAdapters. */
import { formatById, clampFormatDuration } from "./formatCatalog";
import { adaptPromptForEngine } from "./enginePromptAdapters";
import type { ShowBible } from "./showBible";

export interface FillArgs {
  formatId: string;
  topic: string;
  bible: Pick<ShowBible, "premise" | "voice" | "visualWorld" | "cast" | "cadence" | "videoStyles">;
  durationSec?: number;
  cta?: string;
}

export interface FilledPrompt {
  prompt: string;
  durationSec: number;
  voice: "on-camera" | "voiceover" | "none";
  engines: string[];
}

export function fillFormatPrompt(args: FillArgs): FilledPrompt {
  const f = formatById(args.formatId);
  if (!f) throw new Error(`unknown format: ${args.formatId}`);
  if (f.pipeline !== "generate" && f.pipeline !== "documentary") {
    throw new Error(`not a generate format: ${args.formatId}`);
  }

  // Duration: explicit arg > bible per-format range midpoint > format default —
  // always clamped into the format's band.
  const bibleRange = args.bible.cadence?.perFormatDuration?.[args.formatId];
  const requested = args.durationSec ?? (bibleRange ? Math.round((bibleRange.min + bibleRange.max) / 2) : undefined);
  const durationSec = clampFormatDuration(args.formatId, requested);

  const cast = (args.bible.cast ?? [])
    .map((c) => `${c.name} (${c.visualIdentity})`)
    .join(", ") || "the show's presenter";

  // The wizard's per-format tunable choices (StepTunables — e.g. cartoon's
  // "flat 2D" vs "clay 3D" artStyle chip) were stored on bible.videoStyles
  // but NEVER read here — picking one had zero effect on the actual render,
  // it just silently round-tripped through the wizard. Fold every chosen
  // value for THIS format into the {style} placeholder so the choice
  // actually reaches the prompt (and therefore the image/video engine).
  const matchingStyle = (args.bible.videoStyles ?? []).find((s) => s.format === args.formatId);
  const tunableStyleBits = Object.values(matchingStyle?.tunables ?? {});
  const baseStyle = args.bible.visualWorld?.style || "clean modern";
  const style = tunableStyleBits.length ? `${baseStyle}, ${tunableStyleBits.join(", ")}` : baseStyle;

  const values: Record<string, string> = {
    premise: args.bible.premise || "the show",
    topic: args.topic,
    tone: args.bible.voice?.tone || "engaging",
    language: args.bible.voice?.language || "English",
    style,
    durationSec: String(durationSec),
    cast,
    catchphrases: (args.bible.voice?.catchphrases ?? []).join("; ") || "none",
    cta: args.cta || "follow for more",
  };

  const prompt = f.promptTemplate.replace(/\{([a-zA-Z]+)\}/g, (_, key: string) => {
    const v = values[key];
    if (v === undefined) throw new Error(`unfilled placeholder {${key}} in ${f.id}`);
    return v;
  });

  return { prompt, durationSec, voice: f.voice, engines: f.engines };
}

/**
 * Composes ONE beat's per-segment engine prompt from a format-catalog prompt.
 *
 * This is the function the render pipeline (kie-video-pipeline.ts) uses to make
 * the format prompt reach the engine. The segment builders that actually POST
 * to Kie — buildSegmentPrompt / buildGrokPrompt (read `beat.videoPrompt`,
 * falling back to `beat.scene`) and buildExtendPrompt (reads `beat.scene`
 * directly) — never see the top-level `formatPrompt` string or the diagnostic
 * `buildVideoPrompt()` return value; they only ever read fields off each
 * `StoryBeat`. So the caller must overwrite BOTH `videoPrompt` and `scene` on
 * every beat with this result for the format template to actually land in the
 * request Kie receives.
 *
 * `beatScene` is that beat's own visual description (StoryBeat.scene) — the
 * format prompt supplies the durable per-format template, and the beat
 * supplies the beat-specific action, folded in via `adaptPromptForEngine`'s
 * per-engine dialect rules.
 */
export function composeBeatFormatPrompt(args: {
  engineId: string;
  formatPrompt: string;
  beatScene: string;
}): string {
  return adaptPromptForEngine({
    engineId: args.engineId,
    prompt: args.formatPrompt,
    beats: [args.beatScene],
  });
}
