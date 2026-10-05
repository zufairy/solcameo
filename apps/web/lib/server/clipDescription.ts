import {
  resolveDescriptionInstruction,
  generatePostCaption,
  meaningfulBasis,
} from "@/lib/server/captionTransform";

/**
 * The clip's DESCRIPTION — the line an operator reads in Generations and the copy
 * that gets published with it.
 *
 * Without this, a clip is labelled by its row title, and when the source has no
 * usable transcript the analyzer falls back to "Clip 1" / "Clip 2". Those are row
 * LABELS: they describe nothing, they are useless in a gallery, and they used to go
 * out as post copy. Smart Captions exists precisely to write this line, so when it
 * is installed the clip gets a real description whether or not there was a
 * transcript to derive one from.
 *
 * Generated ONCE per clip at render time rather than at publish time, so the same
 * text appears on the card, in the queue and on the post — one clip, one caption.
 */

/** A wired skill as the render path sees it (skillId + its inspector config). */
export interface CaptionSkillLike {
  skillId?: string;
  wired?: boolean;
  captionPrompt?: string;
  descriptionPrompt?: string;
  descFromCaption?: boolean;
}

export const SMART_CAPTIONS_SKILL_ID = "clip.captionstyle";

/** The Smart Captions instruction for this run, or "" when the app isn't wired. */
export function clipDescriptionInstruction(skills: readonly CaptionSkillLike[] | undefined): string {
  const row = (skills ?? []).find((s) => s?.skillId === SMART_CAPTIONS_SKILL_ID && s.wired !== false);
  if (!row) return "";
  // `installed` is what turns the app on — an operator who added Smart Captions and
  // typed nothing still expects a written caption, not silence.
  return resolveDescriptionInstruction(row, { installed: true });
}

/**
 * A deterministic, human label for a clip when no caption could be written —
 * because Smart Captions isn't wired, or the model returned nothing.
 *
 * "Untitled clip" is worse than useless in a gallery of twelve, and a random name
 * is worse still. This builds the label from what is actually known — the campaign
 * the clip belongs to, else the agent's own persona — and disambiguates with the
 * clip's position so two clips from one run are never the same string.
 */
export function fallbackClipLabel(args: {
  index: number;
  campaignTitle?: string;
  agentName?: string;
  niche?: string;
  sourceTitle?: string;
}): string {
  const n = Math.max(1, Math.trunc(args.index) + 1);
  const subject = meaningfulBasis(args.campaignTitle, args.sourceTitle, args.agentName)
    || (args.niche ? `${args.niche} clip` : "");
  if (!subject) return `Clip ${n}`; // nothing known at all — the old label, honestly
  // Trimmed so a long campaign name doesn't push the counter off a card.
  return `${subject.trim().slice(0, 60)} — ${n}`;
}

/**
 * Write the clip's description. Returns "" when Smart Captions isn't wired (the
 * caller then leaves the row's existing text alone) or when generation fails —
 * never a placeholder, because a bad caption is worse than none.
 */
export async function buildClipDescription(args: {
  skills: readonly CaptionSkillLike[] | undefined;
  /** The clip's own words: transcript text, then its caption line, then its title. */
  transcriptText?: string;
  captionText?: string;
  title?: string;
  /** Extra context when the clip itself carries no words (uploads, dead sources):
   *  the campaign it serves, the persona, the source it came from. Used as the
   *  generation basis so the caption is about SOMETHING even with no transcript. */
  fallbackContext?: string;
  apiKey?: string;
}): Promise<string> {
  const instruction = clipDescriptionInstruction(args.skills);
  if (!instruction) return "";
  // meaningfulBasis drops "Clip 2"-style labels: passing one as "what the clip is
  // about" teaches the model the video is about clip 2.
  const basis = meaningfulBasis(args.transcriptText, args.captionText, args.title, args.fallbackContext);
  try {
    return await generatePostCaption({ instruction, basis, apiKey: args.apiKey });
  } catch {
    return "";
  }
}
