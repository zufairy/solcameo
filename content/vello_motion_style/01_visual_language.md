# 01 — Visual language

## Colour tokens

| Token | Hex | Use |
|---|---|---|
| `ink` | `#050505` | Default background (true black reads as "dead"; this is a hair warmer) |
| `ink-2` | `#060606` / `#0A0A0A` | Black type on white fields, window fills |
| `paper` | `#F4F4F2` | White-field scenes and white type (never pure `#FFFFFF` for large areas) |
| `paper-2` | `#F2F2F0` | Logo card background |
| `grey` | `#8A8A8A` | Secondary words ("gets scattered"), captions |
| `grey-light` | `#A8A8A8` / `#BDBDBD` | Sub-lines ("this is", end-card tagline) |
| `dim` | `#3A3A3A` | Rules and hairlines on white |
| `volt` (lime) | `#C8FF00` | ONLY tiny data: `▲ 207,434 views` counters, a live dot |
| Solana gradient | `#9945FF → #14F195` | Used once per film: a 4 px underline under "settled on solana" |

On black, HUD lines are `rgba(255,255,255,0.55)`; on white, `rgba(0,0,0,0.45)`.
Tile walls: dark `#0D0D0D` with a `rgba(255,255,255,0.05)` stroke, or light `#FAFAFA` with a `rgba(0,0,0,0.08)` stroke.

**Ratio:** roughly 75% black scenes and 25% white scenes. Colour accents cover under 1% of any frame.

## Typography

**Primary: Inter (variable)**, always lowercase, for every statement.

| Role | Size @1080p | Weight | Tracking |
|---|---|---|---|
| Payoff line ("the attention economy") | 142 px | 600 | −4% |
| Statement (`BIG`) | 112 px (122–132 for 2-line punch) | 500 | −1.5% (−4% above 120 px) |
| Setup / question (`MID`) | 64–74 px | 500 | −1.5% |
| Sub-line / tagline | 54 px | 500 | −1.5%, grey |
| City labels | 24 px | 600 | UPPERCASE allowed |

**Secondary: JetBrains Mono**, 15–20 px, for HUD only: coordinates, `VLO-00421 ●REC`, `48,213 VIEWS / MIN`, `▲ 12,000 views`, `$2,076.59`.

Text rules:
- 1–4 words per line, at most 2 lines on screen.
- A trailing period is the brand punctuation for statements: "brief in." "edits out." "no timeline."
- A soft shadow on text over footage: `rgba(0,0,0,0.45)`, blur 24. No shadow on paper fields.
- Second line is often grey (`#9A9A9A` or `#D0D0D0`) to create rhythm ("but your reach / gets scattered").
- Words can be split across a window edge, with black type outside on paper and white type inside on footage ("billions | of eyes", "earn | anywhere | on | solana").

## Logo

- Use `vello-logo-white.png` (two-piece mark + "vello" wordmark). In film it is **white on ink** or **tinted #0A0A0A on paper**. Never use lime fills at logo scale.
- End card: logo 760 px wide, centered slightly above the middle, with "the global attention economy" at 54 px grey underneath. Overlay tracking lines at full opacity.
- Hero logo card (on the drop): black logo 1180 px on paper with faint concentric arcs (`rgba(0,0,0,0.05)`), scaling 1.12 → 1.0 with outQuint over 0.6 s.
- 3D: an extruded chrome mark (roughness 0.04, studio strip-light env) on a radial `#2A2A2A → #030303` background.
- Mascots (Flash) are not used in this editorial style.

## Footage

- **Subjects:** night cities and aerials, creators filming on phones and ring lights, editing timelines, candlestick charts, earth from space, motorsport pits and jets, headlights, chrome liquid, runners, bokeh. Real, human, urban; no 3D AI renders.
- **Grade:** fully desaturated, contrast about +25–30%, slightly crushed blacks. Thumbnails get a harder grade: `grayscale(1) contrast(1.3) brightness(1.3)`.
- **Motion on footage:** a slow push in (scale 1.02 → 1.05 per second) plus slight drift. Footage plays at 1× to 1.5×. Never use slow-motion mush.
- **Darken under type:** a 20–45% black overlay when text sits directly on busy footage.
- Source free stock (Pexels) at 1080p or above, pre-extracted to 30 fps JPEG sequences (see `06_pipeline.md`).

## Textures (always on, applied last)

1. **Grain:** 6 pre-baked monochrome noise tiles (640×360, alpha 20/255) stretched full-frame, cycled at 25 fps.
2. **Vignette:** radial from 45% to 110% of frame height, transparent to `rgba(0,0,0,0.55)`.
3. **Tracking band:** a 26 px strip that slides down the frame over 0.06 s every ~2.7 s, offset ±20 px horizontally, with a 3 px white line at 5%.

## Layout

- 1920×1080 canvas with a 110 px side margin for anchored text.
- Thirds grid: HUD crosshairs sit at x = 18% / 82%, y = 16% / 84%. Keep text inside that box.
- Text placements in use: dead center; top-left plus bottom-right diagonal pairs ("agents / get paid" ↔ "for every / verified view"); bottom-left caption at y = H − 150 on maps.
- Windows: a 600–640 px square, centered or offset +120 px right; a 3×2 wall of 520×292 screens with 40 px gaps; floating 16:9 tiles of 380–440 px wide at the four corners; 9:16 city tiles of 200×356.
- Every frame should have one focal point. B/W footage, a window and big type are enough; do not add a fourth element.
