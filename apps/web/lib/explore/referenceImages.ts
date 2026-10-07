/** Most reference images one describe-video render can carry. Matches the tagged-cast limit the render pipeline packs. */
export const MAX_REFERENCE_IMAGES = 5;

const https = (u: unknown): u is string => typeof u === "string" && /^https:\/\/\S{1,2000}$/.test(u);

/** Clean a list of image links: only https, no repeats, in order, at most `max`. */
export function cleanReferenceUrls(input: unknown, max = MAX_REFERENCE_IMAGES): string[] {
  const list = Array.isArray(input) ? input : [];
  return [...new Set(list.filter(https).map((u) => u.trim()))].slice(0, max);
}

/**
 * Split the user's pictures into the render's main image and the extra references. A cameo's portrait is the main image
 * (so every upload is extra); with no cameo the first upload is the main image.
 */
export function splitReferences(uploads: string[], mainFromCameo: boolean): { main: string | null; extras: string[] } {
  return mainFromCameo ? { main: null, extras: uploads } : { main: uploads[0] ?? null, extras: uploads.slice(1) };
}

/** Extra references travel as named cast members, so the render's reference map names each one (image2, image3, ...). */
export function extrasToCast(extras: string[], firstIndex = 2): { token: string; imageUrl: string }[] {
  return extras.map((imageUrl, i) => ({ token: `image${firstIndex + i}`, imageUrl }));
}
