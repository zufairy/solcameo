import sharp from "sharp";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const GIFEncoder = require("gif-encoder-2") as typeof import("gif-encoder-2");

/**
 * Combines multiple still images into a single animated GIF.
 * Each input is fetched, resized to `size x size`, and added as a frame.
 */
export async function makeAnimatedGif(
  imageUrls: string[],
  opts: { size?: number; delayMs?: number } = {},
): Promise<Buffer> {
  const size = opts.size ?? 512;
  const delayMs = opts.delayMs ?? 800;

  // Fetch all frames in parallel as buffers
  const buffers = await Promise.all(
    imageUrls.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch frame: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }),
  );

  // Resize each frame to RGBA raw pixels (sharp guarantees 4 channels with ensureAlpha)
  const rgbaFrames = await Promise.all(
    buffers.map(async (buf) => {
      const { data } = await sharp(buf)
        // Avatars are now generated 9:16 portrait — "attention" crop keeps the
        // subject/face in the square frame instead of blindly taking the middle.
        .resize(size, size, { fit: "cover", position: "attention" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return data;
    }),
  );

  // Build the GIF — useOptimizer=false so we can pass raw RGBA buffers directly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const encoder = new (GIFEncoder as any)(size, size, "neuquant", false);
  encoder.setDelay(delayMs);
  encoder.setRepeat(0); // infinite loop
  encoder.setQuality(10);
  encoder.start();

  for (const frame of rgbaFrames) {
    encoder.addFrame(frame);
  }

  encoder.finish();
  return encoder.out.getData();
}
