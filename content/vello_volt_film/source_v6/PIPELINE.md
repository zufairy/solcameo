# Vello v6 — variation engine

This folder produces **many fast-cut Vello films from one set of footage**. The source is studied once and indexed into small JSON files. After that, each new variation is a ~60-line script: there is no re-transcribing and no re-scanning of footage.

## What is indexed (built once)

| File | What it holds | Built by |
|---|---|---|
| `lines.json` | All 626 spoken lines of the 35-min motivational compilation, with start/end times. Read `lines_short.txt` for a scannable list. | ElevenLabs STT per 4-min chunk, then `align.py` / `align2.py` (pocketsphinx word alignment) and `lines.py` |
| `words.json` / `words.js` | Word-level timings for the lines used so far. These drive the kinetic captions. | `rolls.py` (add ids to `IDS` and re-run) |
| `rolls/L<id>.wav` | Isolated voice for each line, ready to drop on the beat | `rolls.py` |
| `capfree.json` + `cfsheet*.jpg` | 151 caption-free visual windows from the compilation (boxing, Kobe, runners, ships, drummer, interviews) | `capfree.py` |
| `clips_v6.json` → `seq/<clip>/` | Graded B/W 30 fps frame sequences. Compilation captions are inpainted out by `decap.py`. | inline extractor, then `decap.py` |
| `faces.js` | Smoothed face track (centre and size per frame) for 102 clips. Used for punch-ins and the lock-box HUD. | `faces.py` (OpenCV Haar, frontal + profile) |
| `beats_all.json` | Every beat of the song. Drops are at 58.0 s, 125.8 s and 163.6 s. | librosa |
| `dlg/` | Isolated film dialogue: "how much money you make", "crazy? this is obscene", "a million dollars isn't cool…", "complete delusion…" | ElevenLabs isolate |
| `vo/` | Jessica (eleven_v3) brand voice lines: j01–j13 and n1–n9 | ElevenLabs TTS |

## How a variation is written

`v1.js`, `v2.js` and `v3.js` each export `SHOTS`, which is a list of `[startTime, sceneFn]` pairs. Start times are always written in beats with `K(beat)`. Scene functions come from `lib.js`:

- `dlgWin` — face window plus stacked lowercase lines (the film-dialogue hook)
- `roll` — **audio roll**: rapid montage, optional `face:true` (tracked punch-in and lock box), and kinetic captions from `lines: [[lineId, atSeconds, {trim, maxw}]]`
- `windowSq`, `wall`, `punch`, `proof`, `map`, `solanaWin`, `logoCard`, `bigWord`
- `endFlash` — the long flashy Vello ending: 4 beats of black/white strobe flips with clip flashes, then a logo hold with a heartbeat flash, URL and disclaimer

`wantFlash(k)` sets the inverted-flash policy for each beat. `mix6.py` holds the matching audio timeline for each variation: `R(lineId, at)` for rolls, `VO(name, at)` for brand voice, `DL(file, a, b, at)` for dialogue, plus SFX.

**To keep a roll's audio aligned with its caption** after trimming the audio by `Ta` (when the caption uses `Tv`), place it at `at + Ta - Tv`.

## Commands

```bash
python3 -m http.server 8769 &          # serve this folder
node still.js 2 5 12 30                # stills for variation 2 at those seconds → stills/
./renderall.sh                         # render all variations (30 fps) → frames1/ frames2/ frames3/
python3 mix6.py 1 2 3                  # build mix1.wav … mix3.wav
ffmpeg -framerate 30 -i frames1/%05d.jpg -i mix1.wav -c:v libx264 -crf 19 -pix_fmt yuv420p -c:a aac -b:a 256k -shortest VELLO_V6_1.mp4
```

## Making variation 4+ cheaply

1. Pick lines from `lines_short.txt` by id. Add new ids to `IDS` in `rolls.py` and run it (seconds).
2. Pick visuals from `cfsheet*.jpg` (compilation) or the film/stock clips already in `seq/`.
3. Copy `v3.js` to `v4.js` and `spec('3')` in `mix6.py` to `spec('4')`. Add a song offset `S0` for `'4'` in `beats.js`, then edit.
4. Check stills, render, mix and encode. Verify the voice once with STT on the mix.

## Rights note

The film clips (*The Wolf of Wall Street*, *The Social Network*), the compilation speakers' voices and likenesses, and the song are all third-party and unlicensed. They are fine for internal hype and organic tests. Swap them for licensed or owned material before any paid or brand-account use, and never imply that a real person endorses Vello.
