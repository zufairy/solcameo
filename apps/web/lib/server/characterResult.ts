import { getStatus } from "./higgsfield";
import { getObjectText, mirrorImageToR2, putImage } from "./imageStorage";
import type { CharacterImage } from "@/lib/character/types";

/** A completed request is mirrored once to a stable path and indexed for history. */
export async function characterResult(scope: string, id: string) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw new Error("Invalid generation id");
  const cacheKey = `characters/${scope}/results/${id}.json`;
  const cached = await getObjectText(cacheKey);
  if (cached) {
    const images = JSON.parse(cached) as CharacterImage[];
    return { status: "completed", urls: images.map(i => i.url), url: images[0]?.url };
  }
  const r = await getStatus(id);
  if (r.status !== "completed") return { status: r.status, error: r.error };
  const rawJob = await getObjectText(`characters/${scope}/jobs/${id}.json`);
  const job = rawJob ? JSON.parse(rawJob) : null;
  const stored = await Promise.all(r.imageUrls.slice(0,4).map((url, index) => mirrorImageToR2(url, { key: `characters/${scope}/gen/${id}/${index}.png` })));
  const images: CharacterImage[] = stored.flatMap(image => image ? [{ url: image.url, model: job?.model ?? "reference", ratio: job?.ratio ?? "3:4" }] : []);
  if (!images.length) return { status: "failed", error: "Could not store the portrait. Retry the status check to recover it." };
  await putImage(Buffer.from(JSON.stringify(images)), "application/json", { key: cacheKey });
  return { status: "completed", urls: images.map(i => i.url), url: images[0].url };
}
