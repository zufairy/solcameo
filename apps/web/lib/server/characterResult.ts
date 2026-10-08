import { refundImage } from "./imageBilling";
import { refundStudioRun } from "./studioGenBilling";
import { getStatus, submitImage } from "./higgsfield";
import { createQwenEditTask } from "./kieStudioImage";
import { pollNftTaskOnce } from "./nftKie";
import { getObjectText, mirrorImageToR2, putImage } from "./imageStorage";
import type { CharacterImage } from "@/lib/character/types";

/** After this long a pending nano-banana-pro render also starts a backup render. */
const BACKUP_AFTER_MS = 55_000;

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
  // A KIE nano-banana-pro job: one quick poll per call. If it is slow or fails, a backup engine (Qwen, then Soul) starts
  // and whichever finishes first wins, so the user waits once and the run does not fail.
  if (job0?.provider === "kie") {
    const finish = async (url: string) => {
      const stored = await mirrorImageToR2(url, { key: `characters/${scope}/gen/${id}/0.webp`, optimize: true });
      if (!stored) return { status: "in_progress" }; // the render is done; storing it is retried on the next poll
      const images: CharacterImage[] = [{ url: stored.url, model: job0.model ?? "nano", ratio: job0.ratio ?? "3:4" }];
      await putImage(Buffer.from(JSON.stringify(images)), "application/json", { key: cacheKey });
      return { status: "completed", urls: [stored.url], url: stored.url };
    };
    const primary = await pollNftTaskOnce(id);
    if (primary.status === "success") return finish(primary.url);
    const slow = Date.now() - (job0.createdAt ?? Date.now()) > BACKUP_AFTER_MS;
    if (primary.status === "pending" && !slow) return { status: "in_progress", phase: "primary" };
    // Slow or failed: make sure the backup render exists (started once, remembered on the job record).
    let backup = job0.backup as { provider: "kie" | "higgsfield"; id: string; model: string } | undefined;
    if (!backup && job0.prompt) {
      const refs: string[] = job0.refs ?? [];
      try { backup = { provider: "kie", id: await createQwenEditTask({ prompt: job0.prompt, refs, aspectRatio: job0.ratio ?? "3:4" }), model: "qwen" }; }
      catch {
        try { backup = { provider: "higgsfield", id: await submitImage("higgsfield-ai/soul/standard", { prompt: job0.prompt, aspect_ratio: job0.ratio ?? "3:4", resolution: "720p", batch_size: 1, ...(refs[0] ? { image_reference_url: refs[0] } : {}) }, `${id}:backup`.slice(0, 120)), model: "soul" }; } catch { /* no backup available */ }
      }
      if (backup) await putImage(Buffer.from(JSON.stringify({ ...job0, backup })), "application/json", { key: `characters/${scope}/jobs/${id}.json` });
    }
    if (backup) {
      let outcome: { status: "pending" } | { status: "success"; url: string } | { status: "fail" };
      if (backup.provider === "kie") outcome = await pollNftTaskOnce(backup.id);
      else {
        const r = await getStatus(backup.id).catch(() => null);
        outcome = !r ? { status: "pending" } : r.status === "completed" ? (r.imageUrls[0] ? { status: "success", url: r.imageUrls[0] } : { status: "fail" }) : ["failed", "nsfw", "canceled"].includes(r.status) ? { status: "fail" } : { status: "pending" };
      }
      if (outcome.status === "success") return finish(outcome.url);
      if (outcome.status === "pending") return { status: "in_progress", phase: "backup" };
    } else if (primary.status === "pending") return { status: "in_progress", phase: "primary" };
    // Nothing left to wait for.
    if (job0.billingRunId) await refundImage(scope, job0.billingRunId);
    if (job0.studioRunId) await refundStudioRun(job0.studioRunId);
    return { status: "failed", error: "The image could not be generated. You were not charged." };
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
