# 03 — Scene library

Reusable scene recipes from v4.1. The IDs match `shots.js` and the `style_board.jpg` labels. Mix and match them; most films need 12–20 scenes.

---

### I0 · Glass stack cold open
**Look:** the Vello logo sits huge and soft behind a chaotic stack of frosted and clear glass plates and B/W photo cards, at asymmetric angles.
**Build:** three.js. An opaque logo board (canvas texture, plane 26×14.6 at z = −7), 16 BoxGeometry plates with MeshPhysical transmission (roughness 0.35 frosted / 0.04 clear) or photo planes, and a studio PMREM environment. Two plates spawn per half-beat, the camera cuts angle per half-beat, and there is a 25% white flash on every half-beat.
**Use:** the first 4–8 beats of any film. It says "premium, urban, layered".

### A1 · Word over macro footage
**Look:** "every · feed, · every second." over chrome liquid macro.
**Build:** `shot()` full-frame with a slow push; words placed at 30% / 56% width, staggered 0.35 s, then replaced by a centered line.
**Use:** the first statement after the open.

### A2 · Clip change with dots dissolve
**Look:** a candlestick chart becomes a dot field and then earth from space; one centered line holds.
**Build:** swap clips at a beat; within ±0.18 s of the swap draw `dots()` (192×108 luminance grid, exploding).
**Use:** joining two ideas (markets to world).

### A3 · Runner, warp, line-art
**Look:** three looks in 4 beats; text anchored top-left ("everywhere,") and bottom-right ("across 145 countries").
**Build:** cut at beat +1 and +2; the last third is `lineArt()` (horizontal lines displaced by luminance).
**Use:** a "scale / everywhere" beat.

### A4a · White field, square window
**Look:** a paper background with a 600 px square of B/W footage cutting every half-beat. "billions" sits outside left in black; "of eyes" sits inside bottom in white. Inverts on every 4th cut. Tracking lines in black.
**Use:** any "X of Y" phrase, an urban montage in a frame.

### A4b · Screen wall
**Look:** a 3×2 wall of 16:9 screens, each cutting different b-roll every half-beat (staggered), with a 35% dark overlay and one centered line. The wall inverts on odd beats.
**Use:** "on every screen", "every platform", showing volume.

### A6 · Glyph tiles on a tile wall
**Look:** a dark grid of rounded 128 px squares; 10 white glyph tiles (play, heart, chat, share, eye, note, cam, bolt, globe, coin) pop in with outBack; a two-line MID statement with a grey second line.
**Use:** the problem statement ("but your reach / gets scattered").

### B0 · Question, then converge on the drop
**Look:** the same wall. A question builds word by word, then all the tiles fly into the center and become the mark exactly on the drop beat.
**Use:** the beat before the drop, always.

### B2 · Paper logo card (the drop)
**Look:** a black logo on paper with faint arcs and a grey sub-line.
**Use:** the drop hit.

### B3 · Chrome mark
**Look:** the 3D extruded chrome mark on a dark radial background.
**Use:** 4 beats after the logo card, to show the brand has weight.

### C0 · Split screen with a P&L line
**Look:** paper left and a black dotted panel right, a dashed crosshair, a rising line ending at a live `$2,076.59` counter. Black type in diagonal corners: "agents / get paid … for every / verified view".
**Use:** the money / earning claim.

### C1–C3 · Footage with glitch thumbnails
**Look:** full-frame B/W footage (darkened 20–45%) with 3–4 floating 16:9 thumbnails (380–440 px) sliding in at the corners with trails, RGB jitter and scanlines; one big centered line, or a line that switches on beat ("brief in." → "edits out.").
**Use:** product claims: what the agent does, no editing, global network.

### C4 · Earn anywhere window
**Look:** paper with a thirds grid; a 640 px square opens from a line and cuts rotating footage every beat, with the white mark inside. Four words split around the window corners: "earn | anywhere" top and "on | solana" bottom.
**Use:** the core promise; the most recognisable Vello frame.

### C5 · Line field
**Look:** a black field of 30×12 short white strokes rotating randomly, then snapping into an aligned pattern from right to left.
**Use:** a 2-beat breath or reset before a new act.

### M0 · Calm world map with live pins
**Look:** a dotted world map (cell 15 px, 4 px dots at 28% white) with one slow pan from Asia to the Americas. Twelve city pins pop roughly every 0.9 beat; each has a ripple ring, a stem, a 9:16 B/W video tile, an UPPERCASE city name and a lime `▲ 207,434 views` counter that ticks up. A bottom-left caption changes every 4 beats. Bottom gradient, tracking lines on top.
**Use:** the global / earnings proof section; "settled on solana" gets the Solana gradient underline.

### M1 · Payoff line
**Look:** black with tracking lines; "this is" in grey at 102 px over "the attention economy" at 142 px / 600.

### D0 · End card
**Look:** the white logo, a grey tagline and tracking lines at full opacity, fading out together at +2.2 s.

---

## Overlays you can put on any scene

- **`trackLines(c, u, col)`:** two horizontal hairlines (y 16% / 84%, gently wobbling), three dashed verticals drifting, four crosshairs, mono labels at the corners, and a scanning bar.
- **`invert()`:** a one-call negative frame.
- **`gthumbs()`:** the floating glitch thumbnails.
- **`flash(c, '#fff', a)`:** a white flash (intro half-beats only; elsewhere prefer invert).

## Scene-order template (45–50 s)

```
open (glass/logo) → statement over macro → dissolve idea → scale/everywhere →
white window "X of Y" → screen wall → problem (tiles) → question → DROP logo card →
chrome mark → money split-screen → 3× footage+thumbnails claims → earn-anywhere window →
line-field breath → world map proof → payoff line → end card
```
