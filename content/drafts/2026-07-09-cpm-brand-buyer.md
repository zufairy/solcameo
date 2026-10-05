# 2026-07-09 draft — brand-buyer CPM take (NOT posted; X posting outage)

## Post text (final, ready to post)
a brand asked why pay per verified view instead of just booking an influencer.

so i ran the math. a $500 post pulling 50k views looks like $10 per 1k.

but half those views bounce in under 3 seconds. you really bought 25k for $500. that's $20 per 1k.

per verified view you skip the phantom half and only pay for humans who actually watched.

which would you rather buy?

## Format / lane
- Format: numbers / comparison (brand-buyer perspective). Fresh lane vs recent runs which lived on the clipper/platform/distribution side (07-03 verified-views lesson, 07-04 platform-vs-bounty, 07-05 clipper nonlinear payout, 07-07 payout rails, 07-08 distribution/agent-infra). This is the first BRAND-BUYER economics angle (influencer CPM vs per-verified-view). Ends on an answerable question.
- Voice check: all lowercase, no em-dashes, no hashtags, no links, specific numbers, one closing question, no banned words. Not a vello hard-pitch (model described, brand not named in copy).

## Image (on-brand, generated + saved)
- File: content/drafts/2026-07-09-cpm-brand-buyer.png (1600x900, 16:9)
- Source script: content/drafts/2026-07-09-cpm-card-source.py (Pillow, reproducible)
- Concept: STAT-CARD variation from vello-image-theme.md. Near-black #0A0A0F bg with radial glow + film grain + vignette. Lime-green (#C3F000) pixel-art lightning bolt + "vello" mono wordmark top-left. Center: dimmed "$10" -> teal (#00FFD1) arrow -> glowing gold (#FFD700) "$20", teal underline accent. Caption mono teal "REAL COST PER 1,000 VIEWS", muted subcaption "after the phantom half bounces". "vello.gg" bottom-right. Minimal, premium, fully on-theme.

## Why not posted
X was in a broad posting/site outage this whole session (every home + sidebar module rendered "Something went wrong. Try reloading."). The composer accepted the text + image fine, but:
- IMAGE path: file_upload SUCCEEDED (attached the PNG to X's file input, thumbnail rendered) — this SOLVES the attach wall that blocked 07-05/07-07/07-08 (sandbox-file + file_upload beats the clipboard/visibility problem). But X's server-side media processing returned "Some of your media failed to upload" twice (fresh re-attach both times).
- SEND path: with image removed, text-only Post clicked 4x, each returned "Something went wrong, but don't fret — let's give it another shot" and the composer NEVER cleared. X clears the composer only on a successful send, so nothing published (no duplicates). A force reload did not restore X connectivity.
- This was NOT a rate-limit or spam warning.

## Next run
- The file_upload-from-outputs-folder image path WORKS and should be the default going forward (generate on-brand card as a PNG in the outputs folder with Pillow, then file_upload to the X composer's input[type=file]). Only X's own outage blocked today.
- This exact post + image are ready to fire as-is on the next healthy run if still fresh, or interactively.
