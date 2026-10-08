import { refundImage } from "./imageBilling";
import { refundStudioRun } from "./studioGenBilling";
import { getStatus } from "./higgsfield";
import { pollNftTaskOnce } from "./nftKie";
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
  const rawJob0 = await getObjectText(`characters/${scope}/jobs/${id}.json`);
  const job0 = rawJob0 ? JSON.parse(rawJob0) : null;
  // A KIE nano-banana-pro job: one quick poll per call, mirrored to R2 once it has finished.
  if (job0?.provider === "kie") {
    const polled = await pollNftTaskOnce(id);
    if (polled.status === "pending") return { status: "in_progress" };
    if (polled.status === "fail") {
      if (job0.billingRunId) await refundImage(scope, job0.billingRunId);
      if (job0.studioRunId) await refundStudioRun(job0.studioRunId);
      return { status: "failed", error: "The image could not be generated. You were not charged." };
    }
    const stored = await mirrorImageToR2(polled.url, { key: `characters/${scope}/gen/${id}/0.webp`, optimize: true });
    if (!stored) return { status: "in_progress" }; // the render is done; storing it is retried on the next poll
    const images: CharacterImage[] = [{ url: stored.url, model: job0.model ?? "nano", ratio: job0.ratio ?? "3:4" }];
    await putImage(Buffer.from(JSON.stringify(images)), "application/json", { key: cacheKey });
    return { status: "completed", urls: [stored.url], url: stored.url };
  }
  const r = await getStatus(id);
  if (r.status !== "completed") {
    if (["failed", "nsfw", "canceled"].includes(r.status)) {
      const job = job0;
      if (job?.billingRunId) await refundImage(scope, job.billingRunId);
      if (job?.studioRunId) await refundStudioRun(job.studioRunId);
    }
    return { status: r.status, error: r.error };
  }
  const job = job0;
  if (!r.imageUrls.length) {
    // The model finished without an image: nothing was delivered, so the charge or free image goes back.
    if (job?.billingRunId) await refundImage(scope, job.billingRunId);
    if (job?.studioRunId) await refundStudioRun(job.studioRunId);
    return { status: "failed", error: "No image came back. You were not charged." };
  }
  const stored = await Promise.all(r.imageUrls.slice(0,4).map((url, index) => mirrorImageToR2(url, { key: `characters/${scope}/gen/${id}/${index}.webp`, optimize: true })));
  const images: CharacterImage[] = stored.flatMap(image => image ? [{ url: image.url, model: job?.model ?? "reference", ratio: job?.ratio ?? "3:4" }] : []);
  if (!images.length) return { status: "failed", error: "Could not store the portrait. Retry the status check to recover it." };
  await putImage(Buffer.from(JSON.stringify(images)), "application/json", { key: cacheKey });
  return { status: "completed", urls: images.map(i => i.url), url: images[0].url };
}
