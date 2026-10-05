# Hook Style Controls + Show Bible "Video Styles" — Design

Date: 2026-08-21
Status: approved (chat), implementing

## Part 1 — Hook text overlay: bigger, sliders, one saved style for all videos

### Problem
- Default hook design font sizes (48–58) render small on the 1080×1920 canvas.
- AI Clippers inspector (`clip.hook`) exposes only a design picker + top/center/bottom
  dropdown — no size control, no fine position, even though the burn pipeline already
  supports an exact vertical position (`text_overlay.yPct` → `withYPct` in
  `clipFilterGraph`).
- The AI Influencer editor (VideoEditorTab) HAS a size slider (`hookFontScale`) and
  vertical drag (`oy`) but the choice dies with the session — future generated videos
  reset to defaults.

### Design
1. **Bigger defaults**: raise every `HOOK_DESIGNS` render `fontSize` ~35%
   (48–58 → 64–78). Existing saved custom sizes are untouched (custom wins over base).
2. **`CustomHookDesign.yPct?: number`** (0–100, % from the top). Threaded:
   inspector config → `clipEditPlanner` hook floor → `text_overlay` op `yPct`
   (already honored by the ffmpeg graph). When set it overrides the `position` band.
3. **Inspector (clippers)**: in the Auto Hook config, add
   - *Text size* slider: 50–200% of the selected design's base `fontSize`, stored as
     the resolved absolute `hookCustomDesign.fontSize`.
   - *Position* slider: 0–100 (top → bottom), stored as `hookCustomDesign.yPct`.
   Persistence is the existing installed-skill config sync (`agentSkillFiles` /
   `clipJobs` skill-config passthrough) — the style IS the template and applies to
   every future clip automatically.
4. **Influencer editor**: "Save as style" button next to the hook controls. Persists
   `{ hookTemplateId, hookCustomDesign: { fontSize, yPct } }` into the agent's wired
   `clip.hook` skill config (same store the clipper uses). `resolveVideoDirectives`
   already bridges `clip.hook` config into UGC videos; extend the bridge to carry
   `hookCustomDesign` so both apps render the one saved style.

### Testing
- Unit: planner threads `yPct` + custom `fontSize` into the op; `resolveHookRender`
  merge; directives bridge carries `hookCustomDesign`.
- Existing hook design tests updated for the new default sizes.

## Part 2 — Show Bible: Identity core + Video Styles

### Problem
The bible is one flat monolith. Per-video knobs (`format.kinds`,
`variationAxes.hookStyles/structures`, `cadence.perFormatDuration`, rotation) are
spread across sections that each re-describe "what a video looks like" — redundant,
and there is no way to define two deliberately different looks (e.g. a street-interview
show AND a talking-head explainer) that rotate cleanly.

### Design
Split the bible into:
- **Identity** (unchanged fields, edited once): `premise`, `cast`, `visualWorld`,
  `voice`, `visualRefs`, `archetype`, `contentEngine`, `contentMix`.
- **`videoStyles: VideoStyle[]`** (new) — each a named, self-contained recipe:

```ts
interface VideoStyle {
  id: string;            // slug
  name: string;          // "Street interview", "Hot take"
  format: string;        // one format kind (was format.kinds[])
  structure?: string;    // was variationAxes.structures[]
  hookStyle?: string;    // was variationAxes.hookStyles[]
  cameraTreatment?: string;
  durationSec?: { min: number; max: number }; // was cadence.perFormatDuration
  weight?: number;       // rotation share, default 1
}
```

- **Rotation**: the director picks a style by weighted rotation (seeded, mirrors
  `pickRotating`) instead of independently walking hookIdx/structureIdx/formatIdx.
  `RotationState` gains `styleIdx`; legacy indexes stay for old bibles.
- **Migration (normalize-time, no data migration)**: `normalizeShowBible` synthesizes
  `videoStyles` when absent — cross of `format.kinds` × first structures/hooks,
  one starter style per format kind, durations from `cadence.perFormatDuration`.
  Old fields remain readable; new saves write `videoStyles` as the source of truth.
- **UI (`ShowBibleEditor`)**: two groups — "Identity" (collapsed single card per
  field group) and "Video styles" (card grid: one card per style with name, format,
  duration, hook/structure chips, weight; add/edit/delete). Removes the separate
  variation-axes + per-format-duration forms.

### Testing
- Unit: normalize synthesizes starter styles from a legacy bible; weighted rotation
  distribution; round-trip of an authored `videoStyles` bible.
