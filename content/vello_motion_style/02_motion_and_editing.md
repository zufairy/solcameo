# 02 — Motion and editing

Fast comes from the cuts, not from fast camera moves. Each shot is calm inside; the edit is aggressive.

## 1. Build a beat grid first

1. Pick the song section, about 47 s from a breakdown, into a drop, through the outro.
2. Detect the beats with librosa (`beat_track`, then refine to onsets) and store them relative to the section start: `BEATS = [...]`. Use `K(k)` to get the time of beat *k* (fractional *k* interpolates).
3. Everything is placed in beats, never in seconds: `SHOTS = [[K(8), A1], [K(12), A2], ...]`.
4. The v4 song is 103.7 BPM, so one beat (`BT`) is 0.5573 s and a half-beat is 0.279 s.

## 2. Cut rhythm (the pacing map)

| Section | Beats | Scene length | Inner cuts | Energy |
|---|---|---|---|---|
| Cold open (glass + logo) | 0–8 | 8 beats | camera angle cuts every half-beat, plates every half-beat | tease |
| Act I: the problem | 8–32 | 2–4 beats | footage swaps on beat; dots dissolve between clips | building |
| **Drop** | 32 | hit | logo card lands exactly on the drop | peak |
| Act II: the product | 32–62 | 4 beats | glitch thumbnails every 0.28 s; window cuts every half-beat | max |
| Act III: the world | 62–76 | 14 beats, one shot | pins pop every ~0.9 beat; caption changes every 4 beats | calm but alive |
| Payoff + end card | 76–88 | 4 + 8 beats | none | resolve |

Rule: **the longer the scene, the more inner cuts it needs** (window swaps, tiles, flashes). The calm map scene stays alive through popping pins and ticking counters, not camera speed.

## 3. Inverted flash frames (signature)

A full-frame `globalCompositeOperation = 'difference'` fill with `#fff` for **0.06 s (3 frames at 50 fps)** at the start of the beat:

- every cut beat
- before the drop: every 4th beat (k % 4 == 2)
- after the drop: every even beat
- map section: every odd beat (it offsets against the pin pops)
- none in the 4 beats before the logo, so the payoff stays clean

Some scenes invert internally too: the "billions" window flips black/white on every 4th half-beat, and the screen wall inverts for 0.09 s on odd beats.

## 4. Glitch language

| Effect | Spec | When |
|---|---|---|
| Cut glitch | Cyan/red RGB split (±14 px, additive 35%) plus 9 horizontal slices displaced up to ±90 px, decaying over 0.09 s | first 0.09 s of every scene |
| Tracking band | A 26 px band sliding down with ±20 px offset | every ~2.7 s, whole film |
| Thumbnail jitter | ±9 px RGB split at 50% plus 6 slice displacements up to ±30 px | first 0.16 s of a tile, then randomly about 1 in 37 frames |
| Tile scanline | A 10 px band at 10% white moving down the tile at 260 px/s | always on tiles |

## 5. Text animation

- **`word()` reveal:** opacity 0→1 and rise 14 px→0 over 0.28 s with outCubic, plus 3 ghost copies offset 6 px horizontally that fade as it settles. It reads as a "blur-in".
- **Stagger:** a two-line statement starts the second line 0.3–0.6 s after the first. In a word-by-word sentence ("what if your agent did it all?") each word comes 0.2 s after the last, starting at 12% opacity.
- **Out:** a 0.2 s fade, or just a hard cut with the scene. Never slide text out.
- **Text switch on beat:** "brief in." becomes "edits out." on a beat inside the same shot.

## 6. Easing palette

| Ease | Use |
|---|---|
| `outExpo` | windows opening (0.25–0.3 s), underline draw |
| `outQuint` | thumbnails sliding in, logo settle, pins scaling up |
| `outCubic` | word reveals, chart line draw |
| `inOutExpo` | icons converging into the mark on the drop |
| `inOutCubic` | the one slow camera move (map pan); line-field alignment |
| `outBack` (1.6) | glyph tiles popping in |

## 7. Transitions (in order of preference)

1. **Hard cut on beat, with glitch and invert.** This is 90% of all transitions.
2. **Dots dissolve:** footage turns into a luminance dot grid, explodes and reforms as the next clip (±0.18 s around the cut).
3. **Converge:** scattered elements fly into a single mark on the drop.
4. **Window open:** a square clip-rect expands from a line with outExpo.
5. **Line-art switch:** footage becomes displaced horizontal lines (a Joy Division style silhouette) for 1 beat.

No cross-dissolves, no zoom-blur transitions, no slides.

## 8. Camera (3D scenes)

- Glass intro: 16 plates (frosted glass, clear glass, B/W photo planes) spawn two per half-beat at random asymmetric angles in front of an opaque logo board. The camera cuts to a new angle every half-beat; it does not glide.
- Chrome mark: a slow rotation (`u * 1.6` rad scale), exposure 1.35.
- 2D push: footage scales about +3–5% per second. Maps zoom 1.05 → 0.92 over the whole 14-beat scene.

## 9. Frame rate and length

- Render at 50 fps (smooth glitches, crisp 3-frame flashes). 1920×1080. Deliver H.264 CRF 19, AAC 256k.
- Default length is 45–60 s for X / LinkedIn. A cut-down is 15 s: cold open, drop, logo card, earn anywhere on solana, end card.
