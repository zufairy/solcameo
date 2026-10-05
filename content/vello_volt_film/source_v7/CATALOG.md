# Vello footage, speech and music catalog

Everything here is indexed once, so new films are written from these files without re-transcribing or re-scanning footage.
Paths are relative to `source_v7/`. The v6 indexes live in `source_v6/`.

## Songs (`Vello Final Videos/Audio`) — `songs.json` has the beats and 2 s energy for each

| Key | Track | Tempo (edit beat) | Structure (seconds) | Used in |
|---|---|---|---|---|
| `meta` | METAMORPHOSIS — Wolf of Wall Street edit (phonk) | 172 bpm, edit beat every 2 (0.70 s) | quiet 0–10 · drop 10–22 · break 22–32 · drop 32–43 · break 44–54 · drop 54–88 · outro 88–100 (film dialogue in outro) | V4 |
| `sky` | Tristan Tate — Skyfall | 152 bpm, edit beat every 2 (0.79 s) | quiet intro 0–80 · build 80–142 · lift 142 · peak 196–268 · outro 268–281 | V5 (spliced 186–246 + 266–281 → `songs/sky_cut.wav`) |
| `gp` | Tate Brothers — Gangsta's Paradise | 162 bpm, edit beat every 2 (0.74 s) | steady 0–82 · dip 82 · run 84–106 · dip 106–118 · run 120–144 · outro 144–155 | V6 |
| `ybr` | Melly Mike — Young Black & Rich (slowed + reverb) | 129 bpm, edit beat every 2 (0.95 s) | intro 0–14 · groove 14–74 · long outro 74–91 · **explicit lyrics** | V7 |
| `lmk` | Juice WRLD — let me know (your remix) | 123 bpm, every beat (0.46 s) | intro 0–14 · drop 14–42 · … · break 164–178 · drop 178–214 · outro 214–231 | V4 earlier, V8 |
| `mt` | Wolf of Wall Street — Money Trees edit audio | 144 bpm | 0–53, contains film dialogue | spare |
| rockstar | Post Malone — rockstar (Soner Karaca remix) | 99.4 bpm (0.60 s) | drops at 58.0, 125.8, 163.6 | v5, V1–V3 |

The variant beat grids live in `beats7.json`: start offset, edit beats and duration per variant.

## Clips

- **Asset 2** (`a2_shots.txt` lists all 311 shots: id, source, in, out; `a2sheet*.jpg` is the visual index)
  - `tgm*`: Top Gun Maverick (Goosebumps edit)
    - Briefing room: tgm3–9 and 11–17 (burned captions removed).
    - Cockpit and jets: 18–36.
    - Maverick close-up: tgm1.
  - `pplanes*`: Top Gun (Paper Planes edit), fast cockpit and jet cuts.
    - Pilot faces: 2–4, 8–10, 40, 41.
    - Jets: 14–33, 50–53.
  - `ski*`: a cinematic Japanese ski film.
    - B/W salarymen commuting: 11, 13, 19, 20, 22, 24, 43.
    - Suits running into snow: 29.
    - Powder and skiers: 15, 16, 28, 32–41.
  - `elon*`: an Elon Musk interview with SpaceX footage.
    - Interview: 1, 3, 6, 23, 28, 30, 32.
    - Explosions: 5, 7–10, 17–22, 25–27.
    - Landings: 24, 39, 41, 42.
    - Launches: 33–36, 40, 44, 45, 52, 54, 57.
    - Crowd and kids: 46, 48, 49.
    - Starman / Roadster in space: 59–64.
  - `fvf*`: Ford v Ferrari (driver close-ups 4 and 8; race 11 and 12; "7000" sign 6).
  - `freedom*`: supercar POV night drives (5, 7, 9, 10, 12–14, 16) and the night city (18).
  - `brrt*`: helicopters and A-10s, mostly unused.
- **v6 compilation** (`source_v6/capfree.json`, `cfsheet*.jpg`)
  - `cf*` caption-free windows: boxing, Kobe, runners, ships, drummer, interviews.
- **Film edits** from Wolf of Wall Street and The Social Network: `x_*`, `d_*`, `m_*`, `sn_*` (see `source_v5`, `source_v6`).
- **Stock B/W**: creator, edit, head, city, aerial, bokeh, runner, jet, car, warp, chrome.
- **Prep**: every clip is pre-graded to black and white at 30 fps in `seq/<id>/`. Burned captions are inpainted (`decap*.py`). Face tracks are in `faces.js` + `faces7.js` (136 clips).

## Speech (all word-aligned)

- **Compilation, 626 lines** (`source_v6/lines_short.txt`; ids are numbers): the best money and motivation lines, e.g.
  - `168` If you determine to be rich, you'll be rich
  - `71` Only risk takers win
  - `106` Champions do daily…
  - `538` Never been more opportunity…
  - `595`–`597` I made a thousand dollars a month / This is my life / I spray for cockroaches
  - `230` I had to invent a guy that didn't exist
  - `358` Act like the person you want to become
  - `412` Face it, fix it, make it better
  - `469` I didn't quit
  - `474` Other than death, all failure is psychological
  - `345`–`347` I don't lose. I win.
  - `170` Your mind is designed…
  - `260` Anything you want can happen…
  - `337` I always felt like I could do anything
- **Asset 2, 88 lines** (`lines2_short.txt`; ids `E` Elon, `T` Top Gun, `P` Paper Planes, `F` Ford v Ferrari)
  - Elon: `E17` third failure in a row…? · `E18` Never. · `E19`/`E20` Why not? I don't ever give up. · `E21` And the Falcons have landed.
  - Top Gun: `T0` Overwatch reports an F-14… · `T1` Can't be. · `T4` Maverick. · `T5` You're all Top Gun graduates… best of the best. · `T6` That was yesterday. · `T7` Your instructor… · `T8` His exploits are legendary · `T12` I give you (Captain Pete Mitchell)
  - Paper Planes: `P0`–`P5` Good morning, aviators… or else I shoot back · `P11` Don't think, just do.
- **Film dialogue**: "how much money you make" / "72 grand" (dlg/money), "you're looking at me like I'm crazy / this is obscene" (dlg/crazy), "complete delusion… only delusional until it works" (dlg/delusion_iso), "a million dollars isn't cool… a billion dollars" (dlg/billion).
- **Audio files**: compilation lines are in `source_v6/rolls/L<id>.wav`; Asset 2 lines are in `rolls/<id>.wav`. Word timings are in `words7.json` (merged into `words.js`).

**Known bad clips:** `L349` is misaligned (it plays other words). `F1`/`F2` are unreliable. `346` is too short, so use `347` for "I win."

## Brand voice (Jessica, eleven_v3, voice id `cgSgspJ2msm6clMCkdW9`) — `vo/`

| File | Line |
|---|---|
| j01–j13 | v5 lines: old money/new money, clips it, paid every view, 5,000 videos, 145 countries, settled on solana, early, Vello |
| n1–n9 | v6 lines: creator grind, agent never sleeps, a billion views, attention is the new oil, one brief / 145 countries, "Vello. The new money." |
| wa · wb · wc · wq | V4: Day one, zero views · Then he deployed an agent · Same guy, new system · Metamorphosis… complete |
| wd · we · wn | V5: Your mission: one brief… before lunch · Your agents fly the mission, you collect · That's Vello |
| wf · wg · wo | V6: Every launch that failed taught the next one · Your agent learns from every post · Launch yours. Vello. |
| wh · wi · wp | V7: They sold their time, you sell attention · Earn from anywhere · Vello (soft) |
| wj · wk · wl · wm | V8: Here's how the attention economy works · One. A brand drops a brief · Two. Agents create, edit and post… · Three. Every verified view gets paid. On Solana. |
