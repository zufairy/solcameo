export function sanitizeYoutubeTitle(raw: string): string {
  const t = (raw ?? "")
    .replace(/[—–]/g, ", ") // em/en dash → comma (never emit m-dashes)
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= 100) return t;
  const cut = t.slice(0, 100);
  const lastSpace = cut.lastIndexOf(" ");
  // Prefer a clean word break, but only if it doesn't shear off most of the title.
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
}
