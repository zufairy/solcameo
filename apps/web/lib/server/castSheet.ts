import { createHash } from "node:crypto";

/** Tagged characters (@cameo) allowed in one video. */
export const MAX_CAST = 5;

export type CastEntry = { token: string; imageUrl: string };
export type PackedCast = CastEntry & { label: string };

const TILE_W = 512;
const TILE_H = 640;

const individualLabel = (token: string) => `cast member @${token}: keep this exact face, hair and look wherever @${token} appears; never swap it with another person`;

async function download(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > 0 && bytes.length <= 12_000_000 ? bytes : null;
  } catch { return null; }
}

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/**
 * One reference image holding every tagged portrait side by side, left to right in tag order, each with its @name.
 * Engines that accept only a few reference images (Veo, Grok, Seedance 1.5 Pro) get the whole cast through this one slot.
 * The PNG is stored under a hash of its inputs, so the same cast is built once.
 */
export async function buildCastSheet(cast: CastEntry[]): Promise<string | null> {
  if (cast.length < 2) return cast[0]?.imageUrl ?? null;
  // Loaded on demand: sharp is a native module that some runtimes (the Convex action bundle) cannot load at start-up. Where it
  // is missing the cast falls back to individual portraits instead of failing the render.
  let sharp: typeof import("sharp");
  try { sharp = (await import("sharp")).default as unknown as typeof import("sharp"); } catch { return null; }
  const tiles = await Promise.all(cast.map(async (c) => {
    const bytes = await download(c.imageUrl);
    if (!bytes) return null;
    try { return await sharp(bytes).rotate().resize(TILE_W, TILE_H, { fit: "cover", position: "attention" }).png().toBuffer(); } catch { return null; }
  }));
  if (tiles.some((t) => !t)) return null;
  const labels = cast.map((c) => Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_W}" height="${TILE_H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.78"/></linearGradient></defs><rect y="${TILE_H - 120}" width="${TILE_W}" height="120" fill="url(#g)"/><text x="24" y="${TILE_H - 28}" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="700" fill="#fff">@${escapeXml(c.token)}</text></svg>`,
  ));
  try {
    const sheet = await sharp({ create: { width: TILE_W * cast.length, height: TILE_H, channels: 3, background: "#0b0c0e" } })
      .composite(cast.flatMap((_, i) => [
        { input: tiles[i]!, left: i * TILE_W, top: 0 },
        { input: labels[i], left: i * TILE_W, top: 0 },
      ]))
      .png({ compressionLevel: 6 })
      .toBuffer();
    const key = `cast-sheets/${createHash("sha1").update(cast.map((c) => `${c.token}=${c.imageUrl}`).join("|")).digest("hex")}.png`;
    // Loaded on demand for the same reason as sharp: imageStorage pulls in native image code the Convex bundle cannot load at start-up.
    const { putImage } = await import("./imageStorage");
    return (await putImage(sheet, "image/png", { key })).url;
  } catch { return null; }
}

/**
 * Fit the tagged cast into an engine's reference slots. Within the limit every portrait goes in as its own image.
 * Beyond it the whole cast becomes ONE cast-sheet image, so no one is dropped. If the sheet cannot be built the first
 * `slots` portraits are sent instead.
 */
export async function packCast(cast: CastEntry[], slots: number): Promise<PackedCast[]> {
  if (!cast.length || slots < 1) return [];
  if (cast.length <= slots) return cast.map((c) => ({ ...c, label: individualLabel(c.token) }));
  const sheet = await buildCastSheet(cast);
  if (!sheet) return cast.slice(0, slots).map((c) => ({ ...c, label: individualLabel(c.token) }));
  const names = cast.map((c) => `@${c.token}`);
  return [{
    token: cast.map((c) => c.token).join("+"),
    imageUrl: sheet,
    label: `CAST SHEET: ${cast.length} portraits side by side, left to right ${names.join(", ")}; each @name keeps exactly the face, hair and look shown at its position and appears as its own distinct person`,
  }];
}
