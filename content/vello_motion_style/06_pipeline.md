# 06 — Pipeline (how v4.1 was built)

A deterministic, code-rendered film: every frame is a pure function of time `t`, so it can be re-rendered exactly and edited like code.

## Stack

- **2D compositor:** an HTML canvas 1920×1080 (`core.js`, `shots.js`, `main.js`).
- **3D:** three.js (glass intro, chrome mark) rendered to an offscreen canvas and drawn into the 2D frame (`gl.js`, `gl2.js`).
- **Renderer:** Playwright headless Chromium with SwiftShader WebGL (`--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`). It calls `await render(t)` and writes JPEG frames at quality 0.94.
- **Footage:** pre-extracted B/W JPEG sequences in `seq/<clip>/%05d.jpg` at 30 fps, registered in `seq/clips.js` as `window.CLIPS = {clip: {fps, n, loop}}`.
- **Server:** `python3 -m http.server 8767` from the project root.

## Footage prep

```bash
# per stock clip (Pexels 1080p+): grayscale + contrast, 1280 wide, 30 fps, 4–7 s
ffmpeg -ss 1 -t 6 -i src/clip.mp4 -vf "fps=30,scale=1280:-2,hue=s=0,eq=contrast=1.25:brightness=-0.02" -q:v 3 seq/clip/%05d.jpg
```
Then add `"clip": {"fps": 30, "n": <frames>}` to `seq/clips.js`.

## Two-pass render(t)

`render(t)` first runs the scene in **collect** mode to list every image URL the frame needs, loads the missing ones (with an LRU cache of about 200–300 images), then draws for real. This keeps renders deterministic with no async gaps.

## Compositor order (`main.js`)

1. Scene function for the active shot (from `SHOTS`).
2. Cut glitch (first 0.09 s of each shot).
3. Periodic tracking band.
4. Beat-synced inverted flash frames.
5. Grain, then vignette.

## Commands

```bash
python3 -m http.server 8767 &                     # serve
python3 mix.py                                     # → mix.wav
node rend.js 0 600 & node rend.js 600 2350 &       # parallel workers (skip existing frames)
ffmpeg -framerate 50 -i frames/%05d.jpg -i mix.wav -c:v libx264 -preset medium -crf 19 \
  -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 256k -shortest VELLO_FILM.mp4
ffmpeg -i VELLO_FILM.mp4 -b:v 4M -maxrate 5M -bufsize 8M -c:a aac -b:a 192k preview.mp4   # <30 MB share copy
```

Glass and 3D scenes render about 3–5× slower; give them their own worker. About 1 frame/s per worker on SwiftShader.

## QA checklist

- [ ] A contact sheet of one frame per scene: B/W only, text inside the safe box, no clipped words.
- [ ] Cuts land on beats (scrub with audio around the drop).
- [ ] Flash frames are visible but don't strobe more than every half-beat.
- [ ] VO passes speech-to-text 100%.
- [ ] Loudness is around −8 LUFS and the true peak is at or below −0.6 dBFS.
- [ ] Logo is white or black only; the Solana gradient appears once.
- [ ] Music is licensed for public use.
