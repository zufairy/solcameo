# Vello — image theme v2 (Google Flow master prompts + brand rules)

Use this for every @alongrocket / Vello social image. Generate in **Google Flow** (labs.google/fx/tools/flow, Nano Banana 2) — Flow is the REQUIRED primary source. Nano Banana renders flat graphic design and short text well, so lean into editorial graphics, not 3D renders.

## What Vello actually is (get this right in every post + image)
Vello (vello.gg) is **the AI influencer network**. You launch an AI influencer with its own face, persona, and memory in minutes. It creates short videos in its own consistent look, auto-posts daily to TikTok, Reels, Shorts, and X, takes brand campaign bounties, and earns per **verified view** — an oracle checks the views before payout, and earnings settle in USDC on **Solana**. First agent free, next for $30.

Five pillars (image subjects should map to one of these or the economics around them):
1. **UGC creation** — face-consistent AI short videos on demand
2. **AI clipper** — one long video → ten clips, smart captions per platform
3. **Auto-posting** — daily posts across every platform, on schedule
4. **Brand campaigns** — bounties like "$3.00 / 1k views", clips auto-submit, oracle verifies
5. **On-chain payouts** — instant, auditable USDC on Solana

Real proof points to draw from: cliphauz runs a Vello clipper fleet at **$30K/mo** with **42,000 clips/month**, a 3-person team, **0 editors**; a creator did **$12K in her first 30 days**; 10,000 users with no human creators.

## The logo (exact — never improvise a different bolt)
The Vello mark is an **8-bit pixel-art lightning bolt**: classic bolt silhouette built from square pixels, **electric lime green (#C3F000)** with **darker green inner shading** and a thin dark outline, plus **3 short pixel speed-dashes trailing off its left side** (it reads as speed/energy). The wordmark is chunky lowercase pixel letters "**vello**" in white. On dark backgrounds only. When prompting Flow, describe it exactly like this; when it matters, keep the logo small in a corner rather than the hero.

## Look & feel v2 — "daily posting", not launch film
The old theme (cinematic 3D hero renders, volumetric light, holographic humans) looked over-produced and AI-generated. The new look is what a design-literate founder posts daily:

- **Flat, editorial, graphic-design-led.** Think premium dark brand graphics (Solana/Phantom/Linear-style social cards), drawn shapes and type — not photorealism, not glossy 3D.
- Solid near-black background **#0A0A0F**, very subtle film grain. Generous negative space.
- **One accent per image**, chosen by topic: teal **#00FFD1** (product/infra), violet **#7C4DFF** (agents/AI), gold **#FFD700** (money/earnings) — always alongside lime #C3F000 for the logo/key highlight.
- Type (when the image has text): bold modern grotesque (Space Grotesk feel), white, **max 6 words**, one thought. Mono (JetBrains Mono feel) for small labels/numbers.
- Simple flat illustration or diagram as the subject: clean line work, sharp shapes, slight pixel/8-bit motifs echoing the logo.
- **Banned:** glossy 3D renders, lens flares, volumetric god rays, holographic humanoids, stock people, cheesy coins, robots, clutter, watermarks, gradients-everywhere, more than 2 accent colors.

## Master prompt (Flow / Nano Banana 2 — fill the [SUBJECT])
> Minimal dark editorial social media graphic for a tech brand, flat graphic design style, 16:9. Solid near-black background (#0A0A0F) with very subtle film grain and generous negative space. [SUBJECT]. Color palette: white, electric lime green (#C3F000), and [teal (#00FFD1) | violet (#7C4DFF) | gold (#FFD700)] only. Small brand logo in the top-left corner: an 8-bit pixel-art lightning bolt made of square pixels, electric lime green with darker green inner shading and a thin dark outline, three short pixel dashes trailing left of it, next to the word "vello" in chunky white lowercase pixel letters. Bold modern grotesque typography, clean flat vector shapes, sharp edges, crisp graphic design like a top crypto brand's daily social post. No 3D gloss, no lens flare, no photorealism, no people, no robots, no clutter, no watermark.

### [SUBJECT] recipes by post type
- **Big-type take card** (hot takes): `the short phrase "[3-6 WORD PHRASE]" set huge in bold white grotesque type, one key word in [accent], a small flat pixel-art underline or arrow accent`
- **Diagram / lesson**: `a clean flat line diagram showing [X → Y → Z], thin [accent] lines, simple labeled nodes in small white mono type, the key node highlighted lime green` (e.g. long video → 10 clips → verified views → USDC)
- **Stat card / numbers**: `one huge number "[NUMBER]" in bold white type with the unit in [accent] mono type below, a small flat chart or tally marks beside it` (gold accent for money)
- **Visual metaphor** (fraud, phantom views, black-box platforms): `a simple flat illustration of [metaphor: e.g. a row of identical grey play-button pixels with one glowing lime one; a black box with a teal audit line running through it], drawn in clean flat shapes`
- **Bounty / campaign card**: `a flat UI-style card mock reading "[BRAND-ish name] · $[X] / 1k verified views" in white and gold mono type with a lime pixel bolt badge`

Always append: "flat graphic design, no 3D, no photorealism, no watermark." Match the accent to the topic. The image must SAY the same thing the caption says — one idea, instantly readable at feed size.

## Flow workflow (verified)
1. https://labs.google/fx/tools/flow → New project → paste prompt in "What do you want to create?" → confirm model chip = Nano Banana 2 (image) → send.
2. Wait ~15-25s, screenshot to confirm the tile finished. If the first render is off-brand (wrong bolt, clutter, 3D gloss), re-prompt once with corrections — don't settle.
3. Attach to X (in order):
   a. **Clipboard route** (needs the Flow tab visible/foregrounded — request computer-use access to Google Chrome, which works if Chrome is in this task's allowed apps): click the finished tile once for focus, then via javascript_tool fetch the image → canvas → toBlob → navigator.clipboard.write, switch to the X composer, cmd+v, verify thumbnail.
   b. If headless (clipboard blocked): download 2K lands in ~/Downloads which is unreachable — do NOT waste attempts. Instead **recreate the exact same design with Pillow** in the outputs folder (flat card, same layout language as this file, real bolt shape) → file_upload. Log that Flow generated it but transport forced a Pillow rebuild.
4. Never post an off-brand image. A clean Pillow rebuild of the Flow design beats a wrong-looking Flow render.
