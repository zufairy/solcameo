# Vello film plots (top-of-funnel awareness)

Every film keeps the house brand: B/W footage, lowercase Inter, tracking-line HUD, inverted flashes, lime only for small data, and Vello white on black. Each one changes the **plot, tone, song, type style and ending**.

**Core message, kept the same in all of them:** Vello is the global attention economy on Solana. AI agents create, edit and distribute content across 145 countries. Operators get paid for verified views. Traction: 5,000+ videos, 100+ agents minted in one night.

| # | Title | Angle / plot | Song | Type style | Signature scenes | Ending (cinematic, music plays out) |
|---|---|---|---|---|---|---|
| v5 | The New Money | Wolf dialogue hook → old money sold stocks, new money sells attention | rockstar | kinetic blur-in | dialogue windows, screen wall, proof, map | strobe logo, "Vello" |
| V1 | The New Money 2.0 | money-minded Wolf angle + audio cuts | rockstar (drop 1) | kinetic | face-lock punch-ins | strobe, "Vello. The new money." + "If you determine to be rich…" |
| V2 | Obsessed | grind and discipline: your agent never sleeps | rockstar (drop 2) | kinetic | Raging Bull boxers, creator grind | strobe + "Winning is for the obsessed." |
| V3 | What If | FOMO and opportunity, Social Network "a billion views" twist | rockstar (2 drops) | kinetic | speed montage, deathbed what-if | strobe + "Go." |
| **V4** | **Metamorphosis** | transformation: broke clipper ("I spray for cockroaches") → deploys an agent → becomes the operator | METAMORPHOSIS phonk | **scramble/decode**, slam, mask | day-1 counter, terminal "agent online", before/after split, 3D chrome | letterboxed slow montage → "metamorphosis complete." → logo decodes → "I win." |
| **V5** | **The Best of the Best** | Top Gun mission: briefing → mission (one brief, 145 countries before lunch) → agents fly it, you collect | Skyfall (spliced) | **military mono typewriter**, slam | briefing face-locks, radar with city locks, jet punches, chrome "squadron patch", Overwatch alert | jet flyby → "I give you…" → logo slam → "That's Vello." |
| **V6** | **Never** | builder's persistence: rocket failures → "Never. I don't ever give up." → falcons land → your agent learns from every post | Gangsta's Paradise | **telemetry: outline T-minus numerals**, mask | failure counter, telemetry, slow kids/Starman section, landing confirmed | Starman in space → logo wipe → "I don't ever give up." → "Launch yours. Vello." |
| **V7** | **Freedom** | earn anywhere: Tokyo salarymen escape the 9-to-5; your agent works the night shift | Young Black & Rich (slowed) | **thin wide-tracked luxury** letterforms | letterboxed throughout, night drives, ski powder, few deliberate flashes | night city drive → slow logo fade → "Vello." → "I always felt like I could do anything." |
| **V8** | **How It Works** | explainer in 3 chapters: brand brief → agents create and post in 145 countries → every verified view paid on Solana | let me know (your remix) | **editorial mask-up**, outline chapter numerals | 01/02/03 chapters, culture/speed montage, "old internet vs attention economy" split | recap montage → logo wipe → "That's Vello." → "I win." |


## Proof and payout beats (unique per film, no shared lines)

The traction facts (5,000+ videos, 100+ agents minted in one night, the site going down) and the Solana payout appear in every film, but each film tells them in its own world, voice line and type style:

| Film | Proof beat | Payout beat |
|---|---|---|
| V4 Metamorphosis | agent terminal log "day 90 · videos_produced 5,000+ · 503 too many agents" → scramble "the site went down." | money montage, scramble "paid out / in seconds." + mono "SETTLED ON SOLANA · x402" |
| V5 Best of the Best | military debrief board "VIDEOS FLOWN 5,000+ · NEW PILOTS 100+ · TOWER DOWN" → slam "we broke the tower." | jet montage, slam "payload delivered." + "PAID ON SOLANA · CONFIRMED" |
| V6 Never | outline numerals counting "5,000 launches" → "100+ new agents. one night." → "we crashed the site. and kept going." | telemetry T-03→T-00 "touchdown confirmed." status "SETTLED · SOLANA" |
| V7 Freedom | (no proof beat — mood film) | night drive, wide-tracked "paid while you sleep." + "ON SOLANA" |
| V8 How It Works | the canonical proof scene (5,000+ wall → 100+ flip counter → 503) | chapter 03 "every verified view, paid on Solana" |

Voice lines for these live in `vo/x1.wav`–`vo/x7.wav` (Jessica, eleven_v3).

## How to make the next one

1. Pick an angle that isn't in the table above (for example: brand/advertiser POV, the agent's own POV, a creator's day, an operator leaderboard, an x402 machine-payments explainer).
2. Pick a song from `CATALOG.md`. Note its edit beat and drops, add a `cfg` entry in the `beats7.json` builder, and choose a type style that no other film uses.
3. Write `vN.js` (scenes in beats with `K(...)`) and `spec('N')` in `mix7.py`, using lines and clips from `CATALOG.md`.
4. Run `node still.js N …`, then `renderall.sh` (or `node rend.js N 0 99999`), then `python3 mix7.py N`, then encode. Check the voice with one STT pass on the mix.
