import { test, expect } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { extractFrames } from "./lib/extractFrames";
import { getVisionVerdict, VisionInfraError } from "./lib/visionVerdict";

/**
 * LAYER 3 — AI-vision assertions on a RENDERED clip. OPT-IN + PAID.
 *
 * This whole file is skipped unless RUN_VISION=1 (it triggers a real model call
 * and, in the live variant, a real pipeline run → real spend). It is also under
 * the `vision` Playwright project, excluded from the default `npm run e2e`.
 *
 * Two variants:
 *   - GOLDEN (deterministic, CI-safe): vision against a committed known-good
 *     MP4 fixture (VISION_GOLDEN_MP4) — content-stable, cost-capped.
 *   - LIVE (manual only): set VISION_CLIP_URL to an MP4 produced by a real
 *     cloud run (run it OUTSIDE Playwright so the spec never pays per UI flake).
 *
 * Model parse/network failures are treated as INFRA (skip), never content fails.
 */

const RUN = process.env.RUN_VISION === "1";

test.describe("layer 3 — vision on a rendered clip (gated)", () => {
  test.skip(!RUN, "vision suite is opt-in/paid — set RUN_VISION=1 to run");

  test("golden clip: captions present + gameplay background", async () => {
    const goldenPath = process.env.VISION_GOLDEN_MP4;
    const clipUrl = process.env.VISION_CLIP_URL;
    test.skip(!goldenPath && !clipUrl, "set VISION_GOLDEN_MP4 (committed fixture) or VISION_CLIP_URL");

    const tmp = await mkdtemp(path.join(os.tmpdir(), "vello-vision-"));
    let input = goldenPath ?? "";

    // LIVE variant: download the MP4 the real run produced.
    if (!input && clipUrl) {
      const res = await fetch(clipUrl);
      if (!res.ok) test.skip(true, `clip download failed: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      input = path.join(tmp, "clip.mp4");
      await writeFile(input, buf);
    }

    const { frameDataUrls } = await extractFrames({
      input,
      outDir: tmp,
      maxFrames: 8,
      fps: 1,
    });
    expect(frameDataUrls.length).toBeGreaterThan(0);

    let verdict;
    try {
      verdict = await getVisionVerdict({
        frameDataUrls,
        // A real transcript would come from the existing KIE transcription path;
        // the golden fixture can ship a sidecar .txt the runner injects here.
        transcript: process.env.VISION_TRANSCRIPT ?? "",
      });
    } catch (err) {
      if (err instanceof VisionInfraError) {
        test.skip(true, `vision infra error (not a content failure): ${err.message}`);
        return;
      }
      throw err;
    }

    // HARD assertions — high-confidence, OCR/scene-strong signals.
    expect(verdict.confidence).toBeGreaterThanOrEqual(0.7);
    expect(verdict.captionsPresent).toBe(true);
    expect(verdict.bgGameplay).toBe(true);

    // SOFT signal — warn but don't fail on the fuzzy SFX-near-beat check.
    if (!verdict.sfxNearBeat) {

      console.warn(`[vision] soft check: sfxNearBeat=false — notes: ${verdict.notes}`);
    }
  });
});
