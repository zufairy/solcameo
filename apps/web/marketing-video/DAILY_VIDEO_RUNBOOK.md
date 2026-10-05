# Vello Daily Video Runbook — 5 films/day
*The self-contained pipeline a fresh Claude Cowork session follows every morning. All paths are inside this repo (`apps/web/marketing-video`). Written 2026-07-02.*

## 0. What you're making
5 finished 16:9 1920×1080 MP4s (30fps), each ~30s (one may be 45–60s "flagship"), motion-graphics in Remotion, all UNIQUE concepts (see §3 rotation + `DAILY_VIDEO_LOG.md` to avoid repeats), all in the same MODERN theme (§2), with ElevenLabs VO + generated music when the Chrome extension is available (fallback: music from `vo/` library + on-screen type carries the message).

## 1. Environment bootstrap (sandbox resets daily)
1. Copy project to local disk (mounted repo blocks some file ops):
   `mkdir -p /tmp/mv && rsync -a --exclude node_modules --exclude out --exclude build <repo>/apps/web/marketing-video/ /tmp/mv/ && cd /tmp/mv && npm install`
2. Chromium for Remotion (network blocks Google; use Playwright CDN):
   `cd /tmp/pw && npm i playwright-core && PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.playwright.dev npx playwright-core install chromium-headless-shell`
   If `ldd` shows missing `libXdamage.so.1`, compile the stub (harmless for headless):
   write a C file exporting no-op XDamage* symbols, `gcc -shared -fPIC -o /tmp/stublib/libXdamage.so.1 xd.c`, export `LD_LIBRARY_PATH=/tmp/stublib`.
3. Fonts are LOCAL (`public/fonts/*.woff2`, loaded by `src/lib/fonts.local.ts` — copy it over `src/lib/fonts.ts` in /tmp/mv; Google Fonts is network-blocked in the sandbox).
4. `remotion.config.ts`: set concurrency 4 (sandbox has 4 cores).
5. IMPORTANT: background processes die between bash calls, and each call ≤45s → render in chunks: `npx remotion render <Comp> out/x_a.mp4 --frames=0-449 …` then 450-899, concat with `ffmpeg -f concat`. ~17fps render speed.

## 2. Theme — "Daybreak Pro" (the modern evolution; use this, not the old volt-on-black)
Base: the light Daybreak world of `src/promos/V6Explainer.tsx` (study it first), upgraded:
- Canvas `#F7F6F1` bone paper + sky-gradient moments (`#BFE3F5→#F7F6F1`); ink `#20261C`; ONE accent lime `#A3E635` (dark-lime `#65A30D` for text on light). Dark ink cards (`#161B12`) for money/data moments only.
- Type: Space Grotesk (display), Geist (body), Geist Mono (labels/numbers), Newsreader italic for one serif accent word per headline.
- Motion rules: springs damping 22–28 (buttery, no bounce spam), word-by-word blur-in headlines, stroke-dashoffset line draws, Ken Burns on footage, staggered card cascades, continuous micro-motion (bobbing chips, counters) — nothing static for >1.5s. Crossfade sections (no hard cuts).
- Real footage: `public/site/cofounder-bg.mp4` (pixel-park hero — the site's own hero), `public/site/vello_clip3.mp4` (vertical agent clip → phone frames). Harvest MORE from vello.gg via Chrome when available: find `<video>` src (convex.cloud storage), download via blob+click in the vello.gg tab, files land in ~/Downloads (request that folder), copy into `public/site/`. Never use copyrighted stock; use site assets, `public/gen/*`, or the pixel/park world.
- Brand: `public/brand/vellosquare.png` glyph, `public/brand/lo.png` wordmark (dark bg only). Every film ends: glyph/wordmark + "Launch an influencer → vello.gg".

## 3. Content rotation (pick 5 pillars/day, never repeat a concept — check & append `DAILY_VIDEO_LOG.md`)
Pillars: (1) Consumer hook / earn-while-you-sleep stories, (2) Product walkthrough (Build/Studio/Campaigns/Earn), (3) Feature deep-dive (UGC creation, AI Clipper, auto-posting, bounties, Solana payouts — one per film), (4) Proof/case studies ($30K/mo Cliphauz, 10K users/7 days, $12K/30 days), (5) The Math (rates, break-even, "agent pays its own rent"), (6) Swarm/scale spectacle, (7) Manifesto/brand anthem ("A new hope for work", "AI should work for humans"), (8) Market/investor angle ($40.5B→$152B, 3× engagement, 73% brands), (9) Persona showcase (Kaverro-style creator stories), (10) Objection-killer (anti-slop uniqueness, account survival, no-card pricing).
Fresh angles/scripts: use the `vello-cmo` skill for hooks, copy, and messaging; docs in repo root (`VELLO_VISION.md`, `VELLO_MESSAGING.md`, `VELLO_WINNING_ANGLE.md`) are canon.

## 4. Audio
- VO: ElevenLabs via the user's logged-in Chrome (claude-in-chrome tools): elevenlabs.io/app/speech-synthesis, Eleven v3. Voices: Donovan (deep male), Meloxia (calm female) — vary per film. Type script (≤75 words for 30s), Generate, click the per-generation Download icon; file lands in ~/Downloads (request folder access). Do NOT enter any credentials.
- Music: elevenlabs.io/app/music (Music v2, ~55s instrumental, "warm optimistic daylight tech" family) or reuse `vo/daylight_music.mp3`.
- Mix (ducking): ffmpeg sidechaincompress — see `vo/mix_vo.sh` for the exact filtergraph (asplit the VO before sidechain+amix).
- If Chrome/ElevenLabs unavailable: mix `vo/daylight_music.mp3` only; log "VO pending" in the daily log.

## 5. Deliver
1. Copy finals to `out/promos/daily/YYYY-MM-DD/` (5 MP4s, named by concept slug) + comp sources to `src/promos/daily/YYYY-MM-DD/`.
2. QA: render 3 stills per comp before full renders; view them; fix layout collisions.
3. Append to `DAILY_VIDEO_LOG.md`: date, 5 concept titles + pillar numbers + VO status.
4. Present the 5 files with present_files and a 1-line description each.
