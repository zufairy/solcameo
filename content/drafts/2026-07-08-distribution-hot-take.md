# 2026-07-08 — draft (distribution / agent-infra hot take)

## Post text (posted as text-only; image generated but unattachable this run)

gm. everyone's shipping trading agents this week.

lowkey the harder problem isn't one more agent chasing the same trade. it's an agent that goes out, earns attention, and can prove the views were actually real.

distribution is the moat nobody's automating yet.

what's the first non-trading job you'd trust an agent with?

## Format
hot take / timely take — distribution & agent-infra lane (NEW vs recent runs: 07-03 verified-views lesson, 07-04 platform-vs-bounty image, 07-05 nonlinear-payout numbers, 07-07 payout-rails lesson). Ties to today's ecosystem beat ("BNB Chain new L1 for agentic trading", 1,091 posts) without pitching vello. Ends on an inviting question.

## Image (ON-BRAND, generated in Google Flow, Nano Banana 2, 16:9)
Concept: distribution hero — chunky 8-bit lime-green (#C3F000) pixel-art Vello bolt on the LEFT; dozens of teal (#00FFD1) + violet (#7C4DFF) light-trail arcs sweeping OUTWARD to the right, fanning into a wide dispersing swarm of small translucent holographic agent figures (= distribution/reach); a few gold (#FFD700) coin-particles trickling back toward the bolt; deep near-black (#0A0A0F) bg, cinematic, negative space on the left, no text. Rendered cleanly, fully on-theme.
- Flow project: https://labs.google/fx/tools/flow/project/fb0a885b-f203-4cfa-b58d-2389aa002788
- Flow media name/id: 4d29bca0-be6f-40d5-8690-ba53e353971e
- Can be manually/interactively attached to the post later.

## Why image couldn't auto-attach (scheduled/headless run — same wall as 07-05, 07-07)
- Flow tab reports document.visibilityState==='hidden' (hasFocus true, but visibility hidden alone hangs navigator.clipboard.write()).
- Fetching the image bytes via the Chrome JS tool returns an empty {} (anti-exfil guard strips binary/image results), so no path to a real file in a shared folder for file_upload.
- Foregrounding Chrome via computer-use to fix visibility: blocked — "Computer-use access can't be approved during a scheduled run."
- Flow "download 2K" lands in ~/Downloads, which is NOT a connected/shared folder, so file_upload can't reach it.
- FIX so images auto-post in future scheduled runs: add Google Chrome to THIS task's computer-use settings (lets the Flow tab be foregrounded → clipboard.write works), or run this task interactively when an image is required.
