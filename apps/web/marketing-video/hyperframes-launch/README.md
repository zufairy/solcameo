# Solcameo: Main Character

A 27.43-second, 1920×1080 launch trailer built with HyperFrames and GSAP. The narrative introduces AI influencers, then connects character creation, AI content and token launch into one product story.

Edit `index.html`. Typography uses Anton and Inter. The footage is muted; the soundtrack is trimmed, loudness normalized, and faded at the end. No synthetic revenue or follower claims are included.

## Source assets

Original files remain untouched. The six 540×960 production copies come from `/Users/along/Downloads/generated_video (3).mp4`, `(5).mp4`, `(7).mp4`, `(11).mp4`, `(12).mp4`, and `(6).mp4`, in that order. Each starts 0.2 seconds into the original and runs for seven seconds.

Logo and mascot are copied from `apps/web/public/brand/solcameo-dark.png` and `solcameo-mark.png`.

Music: user-supplied `METAMORPHOSIS - Wolf Of Wall Street edit [gh0Lk7dyg-U].mp3`, from 62.5 seconds, normalized to -14 LUFS with a final fade. No source-video speech is mixed into the trailer.

## Render

Run `npm ci`, then `./render.sh` from this directory on the current Mac. The script uses the repository's FFmpeg binary and the local ffprobe package. The HTML, fonts, GSAP runtime, footage and soundtrack are local, so the composition needs no remote CDN.

Output: `../out/solcameo-launch-hyperframes/solcameo-main-character-16x9.mp4`.
