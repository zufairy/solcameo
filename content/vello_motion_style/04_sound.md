# 04 — Sound

The sound is what hypes it up. Keep the music loud and punchy, the voice clear on top, and the SFX tight to the picture.

## Music

- A hip-hop / trap or melodic-rap beat at around 95–110 BPM with a clear breakdown → drop. The film structure follows the song: breakdown (Act I), drop (logo), full beat (Act II), outro (map + end card).
- Pick a ~47 s section that has the drop around 17–18 s.
- Gain: music at 1.25× with +2 dB at 60 Hz for chest punch. The user's feedback was that **more music is better**: do not bury it.
- **Licensing:** v4 used a user-supplied Juice WRLD remix, which is unlicensed. For public ads use licensed or commissioned music (or ElevenLabs `compose_music`) with the same structure.

## Voice-over (ElevenLabs)

- **Voice:** Jessica, model `eleven_v3`. Female, confident, playful "naughty hype", clear diction and proper intonation. v3 audio tags such as `[excited]`, `[whispers]` and `[laughs softly]` work for attitude.
- **Lines** are short, one per scene, and mirror the on-screen words (see `05_copy_and_voice.md`). Generate each line as its own file, trim the silence, and place it on the beat grid (`K(n) + 0.05`).
- Use `atempo` 1.1–1.35 to fit fast sections, but never above 1.35.
- **Verify** intelligibility by running the final mix through ElevenLabs speech-to-text. Every line must transcribe correctly; boost any line that fails (v4: "scattered" 1.6×, final "Vello" 2.4×).

## SFX palette (`audio/v2`, `sfx/`)

| Sound | Where | Gain |
|---|---|---|
| glass clink | each glass plate in the intro (alternate 0.14 / 0.2) | low |
| subdrop | the first frame, the drop, the end card | 0.35–0.7 |
| VHS glitch | every cut in Acts I and II; 4× bursts under the thumbnail scenes | 0.15–0.28 |
| stutter, deepwhoosh | pre-drop tension | 0.2–0.3 |
| soft swish | b-roll window / wall scenes (no heavy hits there; the user flagged them as too strong) | 0.18 |
| ping | each glyph tile and each map pin | 0.08–0.10 |
| shutter | the question scene | 0.3 |
| riser + reverse swell | 3 s and 1.5 s before the drop | 0.35 |
| logo sting | the drop and the end card | 0.35 |

Rule: **one SFX family per job.** Glitches for cuts, pings for UI and data, subs for structure, swishes for movement. Don't stack hits on top of a scene that already has a loud music hit.

## Mix chain (`mix.py`)

```
VO bus:  amix → highpass 90 Hz → +3 dB @3.2 kHz (presence) → −2 dB @250 Hz (mud)
         → acompressor thr 0.12 ratio 4 atk 4 rel 90 makeup 2.2 → ×1.45 → aecho 0.8:0.5:35:0.10 (short room)
Music:   split at 220 Hz
         highs ← sidechain from VO: thr 0.03 ratio 6 atk 8 rel 300   (voice cuts through)
         lows  ← sidechain from VO: thr 0.2  ratio 1.5               (keep the punch)
Master:  music + VO + SFX → alimiter 0.93 → 1.6 s fade out → ~−8 LUFS integrated
```

Delivery: 48 kHz stereo WAV for the master; AAC 256k in the MP4; an MP3 256k copy goes to `audio/`.
