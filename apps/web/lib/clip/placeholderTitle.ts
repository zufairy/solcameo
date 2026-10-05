/**
 * Placeholder clip labels ("Clip 1", "Upload 2") come from the fallbacks in
 * clipAnalysis / clipMomentSelector when a source can't be analysed. They are row
 * LABELS, never post copy and never a caption basis — publishing one reads as a bug,
 * and feeding one to a model teaches it the video is about "clip 2".
 *
 * Pure and dependency-free so the CLIENT can import it: the same rule has to apply
 * in the gallery that applies at publish time, and pulling it from the server-side
 * caption module would drag the LLM client into the browser bundle.
 */
export function isPlaceholderClipTitle(text: string | undefined | null): boolean {
  return /^\s*(clip|upload)\s*\d*\s*$/i.test(text ?? "");
}

/** The first candidate that actually describes something — "" when none do. */
export function meaningfulBasis(...candidates: (string | undefined | null)[]): string {
  for (const c of candidates) {
    const t = (c ?? "").trim();
    if (t && !isPlaceholderClipTitle(t)) return t;
  }
  return "";
}
