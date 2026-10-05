# Clipper Hook Redesign — Prompt-Steered, Animated, Industry-Font Hooks

Date: 2026-07-12
Status: Approved design (pending spec review)

## Goal

Upgrade the AI Clipper's two hook tools so an operator can steer the hook with a
prompt, pick from a small set of polished templates (distinct industry fonts +
smooth animations), choose a 3–6s on-screen duration and top/center/bottom
position, and get a professional, padded, animated burn on the video.

The two tools stay **distinct** (confirmed with the user):

- **Auto Hook** (`clip.hook`) — one hook line burned **on the footage's** opening
  seconds (a `text_overlay`).
- **Hook Title Card** (`clip.title`) — a separate **intro slate** (a card
  concatenated before the clip). Today it has no config UI; it gets the same
  template/font/animation/prompt treatment, rendered on the slate.

The AI Influencer side (`video.autohook`) already has a prompt box and the
`/api/agents/hook/generate` endpoint; this work reuses that endpoint and the
shared template model, but the primary surface is the clipper canvas.

## Non-goals

- No change to caption rendering (`captionRenderer.ts`) beyond extracting shared
  ASS helpers if convenient.
- No new AI model; reuse the existing Claude hook endpoint.
- Not merging the two tools (user chose to keep them separate).
- Influencer `HookConfig` UI stays as-is except it adopts the new template model
  and the 3–6s duration set for consistency (low-risk, optional).

## Components

### 1. Template model (`lib/builder/hookDesigns.ts`)

Add two fields to `HookDesignRender`:

- `font: string` — the ASS `Fontname` (matches a bundled font's internal family).
- `animation: HookAnimation` — `"pop" | "slide-down" | "fade" | "word-reveal" | "pop-overshoot"` (the set used by the 5 templates; extensible).

Keep existing fields (`fontColor`, `fontSize`, `position`, `outlineColor`,
`outlineWidth`, `boxColor?`, `allCaps?`). `preview: CSSProperties` stays, and gains
a matching CSS animation so the inspector chip animates like the burn.

`CustomHookDesign` gains optional `font?` and `animation?` so the "Customize"
toggle can override them too.

### 2. The 5 templates

Each is a distinct font + color + animation + default position:

| id | name | font | look | animation | position |
|---|---|---|---|---|---|
| `bold_impact` (default) | Bold Impact | Anton | white, black outline | pop | top |
| `clean_slide` | Clean Slide | Inter SemiBold | white, soft shadow | slide-down | top |
| `yellow_pop` | Yellow Pop | Archivo Black | yellow CAPS, black outline | pop-overshoot | center |
| `black_box` | Black Box | Montserrat Bold | white on black box | fade | bottom |
| `word_reveal` | Word Reveal | Poppins SemiBold | white | word-by-word reveal | center |

Existing template ids are replaced; a migration maps any legacy stored
`hookTemplateId` (e.g. `bold_white`) to the nearest new id (default `bold_impact`)
so saved graphs keep working.

### 3. Bundled industry fonts (`apps/web/assets/fonts/`)

Commit the 5 OFL-licensed font files (Anton, Inter, Archivo Black, Montserrat,
Poppins — all Google Fonts / OFL). Add `lib/server/hookFonts.ts` mapping a
template `font` name → bundled file path, and an `assetsFontsDir()` returning the
directory so the burn can pass `fontsdir=<dir>` to libass. Include the OFL license
text alongside the fonts.

### 4. Animated ASS hook renderer (`lib/server/hookRenderer.ts`)

New `renderHookAss(text, opts)` → ASS string. `opts`: `{ template, custom?, durationSec, position, width, height }`.

- **Styling**: `Fontname` = template.font, PrimaryColour/Outline/BorderStyle from
  the template (box → BorderStyle 3 + BackColour; else outline). `allCaps` uppercases.
- **Position**: ASS `Alignment` (top=8, center=5, bottom=2) + `MarginV`.
- **Padding (professional centering)**: `MarginL`/`MarginR` inset (~6% of width)
  and a `MarginV` floor (~8% of height) so text never touches an edge; `WrapStyle 0`
  smart-wraps within those margins.
- **Animation** (ASS override tags, smooth at 60fps output):
  - `pop`: `\fscx60\fscy60\fad(60,120)\t(0,180,\fscx100\fscy100)`
  - `pop-overshoot`: scale 50→110→100 via two `\t` segments
  - `slide-down`: `\move` from above the final Y + `\fad`
  - `fade`: `\fad(180,180)`
  - `word-reveal`: one Dialogue per word, each word fading/popping in on its share
    of the duration (evenly split across `durationSec`)
- **Timing**: events span `[0, durationSec]` (exit fade at the tail).

Reuse ASS colour/time helpers from `captionRenderer.ts` (extract a small shared
`assUtils.ts` if it reduces duplication).

### 5. Burn integration

- `lib/server/clipFilterGraph.ts`: accept an optional `hookAssPath` (+ ensure the
  fonts dir is threaded so `subtitles=...:fontsdir=<dir>` resolves the bundled
  fonts). Chain the hook `subtitles` filter after the caption one. The Auto Hook
  path stops emitting a drawtext `text_overlay` for the hook and instead writes the
  hook ASS. Non-hook overlays (sticker/meme) keep using drawtext.
- **Auto Hook (`clip.hook`)**: `clipRender.ts` writes `hook.ass` via
  `renderHookAss` and adds the filter.
- **Hook Title Card (`clip.title`)**: the slate render (currently drawtext on a
  black card) burns its text via `renderHookAss` onto the slate stream, so the
  slate's title animates and uses the template font. Duration configurable (3–6s).
- **Influencer overlay-burn route**: same hook-ASS path so influencer hooks match.

### 6. Prompt box → per-clip AI hook

- **Config**: add `hookPrompt?: string` to `ClipFloorConfig` (and the node config).
  Also add `hookPosition` to `ClipFloorConfig` (currently read but not declared).
- **Inspector**: `HookOverlayConfig` and a new `TitleCardConfig` get a prompt
  `textarea` ("What should the hook be about?", max ~300 chars), mirroring the
  Viral Sticker prompt field.
- **Generation**: at render time, when `hookPrompt` is non-empty, the hook text
  for each clip is written by the Claude hook endpoint (reused from the influencer
  side / `callClaudeText`) using the clip's transcript + the operator instruction,
  instead of the deterministic `hookText(m)` first-6-words. Empty prompt = current
  auto behavior (no LLM call, deterministic hook). This runs in the clip pipeline
  (`clipEditPlanner.applyHookStyle` / the floor builder) where the transcript is
  available.

### 7. Inspector UX (`inspector-panel.tsx`)

- **Prompt box** (both tools).
- **Animated template preview chips**: each chip plays the template's CSS
  animation on a 9:16 mini-frame at the chosen position.
- **Duration**: replace the 1–15 slider with a **3–6s dropdown** (`[3,4,5,6]`).
  Update `clampHookDuration` default range for the clipper to 3–6 (keep a wider
  clamp for legacy/influencer where needed, or clamp to 3–6 uniformly — decided in
  the plan).
- **Position dropdown** (top/center/bottom) — kept.
- Everything persists via `updateNodeConfig`.

## Data flow

Install `clip.hook` → node created → inspector sets `hookPrompt` /
`hookTemplateId` / `hookDurationSec` / `hookPosition` / `hookCustomDesign` →
run → clip pipeline generates hook text (LLM if `hookPrompt` set, else
deterministic) → `renderHookAss(text, {template, durationSec, position, dims})`
writes `hook.ass` → `clipFilterGraph` burns `subtitles=hook.ass:fontsdir=<fonts>`
→ animated, industry-font, padded hook on the clip. `clip.title` is analogous but
renders onto the prepended slate.

## Testing

- **`hookRenderer.test.ts`**: for each template, the ASS contains the right
  Fontname, the expected animation tag(s), correct Alignment for the position, and
  margins ≥ the safe-padding floor. `word-reveal` emits one event per word. Duration
  clamps to 3–6. `allCaps` uppercases.
- **`hookDesigns.test.ts`**: legacy id migration maps old → new; every template has
  a bundled font mapping (no dangling `font`).
- **`hookFonts.test.ts`**: every template font resolves to an existing bundled file.
- **Font-graph smoke** (ffmpeg test, guarded like existing `*.ffmpeg.test.ts`):
  a hook ASS + fontsdir burns without ffmpeg error on a sample clip.
- **Inspector**: rendering-level test that the 3–6 dropdown and prompt box persist
  through `updateNodeConfig` (if the existing inspector tests cover this pattern).

## Risks / decisions

- **libass font resolution**: the ASS `Fontname` must match each font's internal
  family name exactly; `fontsdir=` must reach the burn. Verified per-font at
  implementation via the smoke test.
- **Per-clip LLM cost/latency**: only incurred when a prompt is set; the endpoint is
  Haiku-class and fast. Deterministic path unchanged when no prompt.
- **Duration clamp change** (1–15 → 3–6) must not break influencer stored values;
  the plan will clamp defensively rather than reject.
