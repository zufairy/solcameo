# Music drop-in

The film is cut to a **124 BPM** grid (see `src/audio.ts` for the beat map).

1. Drop a licensed/royalty-free track here as `track.mp3`.
2. In `src/audio.ts`, set `HAS_AUDIO = true`.
3. If your track isn't 124 BPM, set `BPM` to its real value and nudge
   `AUDIO_OFFSET_FRAMES` so beat 1 lands on the hook's first word (~frame 6).

The visuals already hit the documented beats — you only change the audio.

Good royalty-free sources: Artlist, Epidemic Sound, Uppbeat (modern/electronic,
building, ~120–128 BPM).
