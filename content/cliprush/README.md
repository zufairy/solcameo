# Vello — Clip Rush

32 seconds · 150 BPM · 60 fps · music only

Concept: the audience already knows what hits; Vello turns that instinct into a clipping workflow. Real-world footage, real Vello page captures, hard typography, and brief meme punchlines. Campaign earnings are tied to verified views, with USDC / Solana messaging taken from Vello's public product copy. No invented earnings totals or wallet receipts.

Reference studied: https://x.com/MeteoraEco and its 28 September permissionless-builder film (https://x.com/MeteoraEco/status/2104181126575358010). The accessible film uses character-led meme imagery and direct permissionless-builder captions. Its footage and soundtrack are not incorporated. The user's fast-cut, Wall Street energy direction drives this original edit.

Visual sources: Vello homepage and clipping page captured September 28, 2026; existing Vello editor illustration; existing repository stock footage; campaign and payout features captured from the current Vello homepage. Existing stock asset license records were not present in this project and should be retained with the original asset procurement records.

Soundtrack: original instrumental synthesized for this film, 150 BPM, stereo. Source: music.py. No voice or commercial recording samples.

Outputs: ../Vello_ClipRush_1080p60.mp4 and ../Vello_ClipRush_9x16_1080p60.mp4.

Editable composition: ../../apps/web/marketing-video/src/ClipRush.tsx

Render from apps/web/marketing-video:

    npx remotion render src/ClipRush.tsx ClipRush ../../../content/Vello_ClipRush_1080p60.mp4 --crf 18 --concurrency 4
    npx remotion render src/ClipRush.tsx ClipRushVertical ../../../content/Vello_ClipRush_9x16_1080p60.mp4 --crf 18 --concurrency 3
