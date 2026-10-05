import sharp from "sharp";

/** Bound download size without cropping the identity used by image/video models. */
export async function optimizePortrait(input: Buffer, maxDimension = 1600) {
  const metadata = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
  if (!metadata.width || !metadata.height || !["jpeg", "png", "webp", "avif", "heif"].includes(metadata.format ?? ""))
    throw new Error("A supported still portrait is required");
  let output = input;
  for (const [dimension, quality] of [[maxDimension, 82], [Math.min(maxDimension, 1280), 76], [Math.min(maxDimension, 1024), 70]]) {
    output = await sharp(input, { limitInputPixels: 40_000_000 }).rotate()
      .resize(dimension, dimension, {fit: "inside", withoutEnlargement: true})
      .webp({quality, effort: 4}).toBuffer();
    if (output.length <= 350 * 1024) break;
  }
  return output;
}
