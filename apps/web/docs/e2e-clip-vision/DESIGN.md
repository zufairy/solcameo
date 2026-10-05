# Layer 3 — AI-Vision Assertions on a Rendered Clip (Design)

**Status:** design + gated skeleton (libs + a skipped spec). The live KIE call is
a single TODO in `e2e/layer3/lib/visionVerdict.ts`.

## Goal

After a real pipeline run produces an output MP4, assert the clip's *content* is
correct — not just that the UI rendered:

- captions burned in + synced to speech,
- a gameplay / brainrot background present (when Brain Rot is wired),
- a reaction SFX audible near the hook beat.

This is **gated, opt-in, and never part of `npm run e2e`** — it costs money (a
real run + a vision API call) and is nondeterministic.

## Why this is separate from the functional suite

The functional + visual suites are deterministic and free: they drive the
mocked `/dev/clipper` surface and the pre-mint canvas, never running a pipeline.
Layer 3 is the opposite — it consumes a *real rendered artifact* and a *paid
model call*. Mixing them would make every PR slow, flaky, and billable. So Layer
3 lives in its own Playwright project (`vision`) and self-skips unless
`RUN_VISION=1`.

## Flow

```
[real run, gated]                e2e/layer3/vision-clip.spec.ts
  1. Obtain the output clip MP4 URL.
       - GOLDEN  (CI-safe): a committed known-good MP4 (VISION_GOLDEN_MP4).
       - LIVE    (manual) : VISION_CLIP_URL from a real cloud run done OUTSIDE
                            Playwright (a fixture/script that calls the same
                            cloud-run entrypoint the app uses) → no per-UI-flake
                            spend.
  2. Download MP4 → tmp/clip.mp4 (fetch → write).
  3. ffmpeg (bundled ffmpeg-static) extract — e2e/layer3/lib/extractFrames.ts:
       - frames:  -vf fps=1,scale=512:-1  -frames:v 8   (≤8 frames, 512px)
       - audio :  -t 8 -ac 1 -ar 16000  audio.wav       (transcript + SFX)
  4. ONE batched multimodal call → structured JSON verdict
       (e2e/layer3/lib/visionVerdict.ts).
  5. expect(verdict.captionsPresent).toBe(true);
     expect(verdict.bgGameplay).toBe(true); …
```

## Model call

Per repo memory + the project's primary web LLM path, use **KIE (Gemini 3
Flash)** — the same provider/credential (`KIE_API_KEY`, boss-only) already
verified in the clip pipeline (accepts audio, returns segments + word
timestamps). One provider keeps credentials simple.

- **Input:** sampled frames (base64 data URLs) + a short transcript (from the
  audio via the existing KIE transcription) + a **strict JSON-schema
  instruction**.
- **Output schema** (zod-validated in `visionVerdict.ts`):

  ```ts
  {
    captionsPresent: boolean,
    captionText: string | null,
    captionSyncedToSpeech: boolean,
    bgGameplay: boolean,
    sfxNearBeat: boolean,
    confidence: number,   // 0..1
    notes: string         // human-readable triage line
  }
  ```

- **Why structured:** assertions become binary; `notes` aids triage.
- **Temperature:** low (0) for repeatability.
- **Caption-sync** is checked by comparing the burned caption text the model
  reads against the transcript window.
- **SFX-near-beat** is the weakest vision signal → treat as a **soft assertion**
  (warn, don't fail) unless paired with a **deterministic audio-energy
  heuristic** (ffmpeg `astats` / loudness peak in the 1–2s hook window), which is
  cheaper and more reliable than asking the model. `visionVerdict.ts` overrides
  the model's `sfxNearBeat` with `audioPeakDbfsNearBeat` when supplied.

## Where it plugs in

- `e2e/layer3/` + a `vision` Playwright project (`testMatch:/layer3\/.*\.spec\.ts/`)
  in `playwright.config.ts`.
- Specs guard with `test.skip(process.env.RUN_VISION !== "1", …)`.
- Helpers: `extractFrames.ts` (ffmpeg wrapper) + `visionVerdict.ts` (KIE call,
  zod-validated).
- Default `npm run e2e` excludes `vision`. Run explicitly with
  `RUN_VISION=1 npm run e2e -- --project=vision` (see `e2e/README.md`).

## Cost / nondeterminism handling

- **Opt-in env gate** (`RUN_VISION=1`) — never in normal CI/local default. Zero
  default spend (matches the suite's zero-spend ethos).
- **Bounded cost:** ≤8 frames @ 512px + ONE batched model call per clip (~cents).
- **Soft vs hard:** hard-assert high-confidence deterministic-ish signals
  (captions present — OCR-strong; background present) and require
  `confidence ≥ 0.7` before failing; soft-assert (warn) fuzzy ones (SFX-near-beat).
- **Golden-clip fixture:** run vision against a committed known-good MP4 as the
  *deterministic* baseline so Layer 3 can run cost-capped + content-stable in CI;
  the live-run variant stays manual.
- **Retry / idempotency:** allow 1 retry on the model call (network); a model
  parse/transport failure is an **infra error** (`VisionInfraError` → `test.skip`),
  never a content failure.

## Open items before going live

1. Wire the KIE multimodal request in `visionVerdict.ts` (the single TODO),
   mirroring the clip-pipeline transcription request shape + auth header.
2. Commit a golden MP4 fixture + sidecar transcript and document its path.
3. (Optional) Implement the deterministic `astats` loudness peak extractor and
   feed `audioPeakDbfsNearBeat` so the SFX check stops depending on the model.
