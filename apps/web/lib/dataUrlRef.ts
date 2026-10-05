// Parse a browser `data:<mime>;base64,<data>` URL (as produced by FileReader
// `readAsDataURL` / `canvas.toDataURL`) into the `{ mimeType, base64 }` shape the
// image-generation routes expect for reference photos.
//
// WHY THIS EXISTS: the clip-agent avatar flow lets the operator upload a
// reference photo so the generated cover matches that image. The uploaded file
// is captured as a data URL, and the raw base64 + its mime type must be split
// back out to send to `/api/generate-nft-images` as
// `referenceImages: [{ data, mimeType }]`. Keeping that split in one tested
// helper stops the "upload a photo but it isn't used" regression from silently
// creeping back in (a broken split → no reference → a generic face).

export interface DataUrlRef {
  /** Raw base64 payload (no `data:...;base64,` prefix). */
  base64: string;
  /** MIME type, e.g. `image/jpeg`. */
  mimeType: string;
}

/**
 * Split a base64 data URL into its mime type and raw base64 payload.
 * Returns `null` for anything that isn't a base64 data URL (e.g. an http(s)
 * URL, an empty string, or a `data:` URL that isn't base64-encoded).
 */
export function parseDataUrlRef(dataUrl: string | null | undefined): DataUrlRef | null {
  if (!dataUrl) return null;
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const mimeType = m[1];
  const base64 = m[2];
  if (!mimeType || !base64) return null;
  return { mimeType, base64 };
}
