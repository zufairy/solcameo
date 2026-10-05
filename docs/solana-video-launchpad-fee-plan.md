# Vello: video-native token launchpad

4 October 2026. Current strategy, replacing the subscription/service proposal.

## Product decision

A Solana launchpad for living memes: create an original character or meme, generate its launch video, launch a token through Meteora DBC, and discover it in a video feed with trading controls. Accrued trading fees fund subsequent episodes. No subscription or retainer. Token launch and trading are the core product; Vello supplies the content engine.

Working name: Vello. Public descriptor: "The video-native launchpad on Solana." Alternatives: Vello.fun or LoreMint; domain, handle, and trademark availability have not been established.

The launch unit is one character/community token with many videos. Community members suggest scenes and publish authorized remixes linked to the same mint. Do not mint a new token for every episode. A token is a community/speculative asset, not ownership of character IP or an entitlement to content revenue.

## Pump.fun research

Pump's official fee page currently says coin creation is free at the platform level, graduation costs 0.015 SOL, and bonding-curve trades pay 1.25%: 0.95% protocol and 0.30% creator. Network costs are separate. Canonical PumpSwap fees vary by market-cap tier; do not apply the curve protocol percentage to graduated pools. The page was last updated 20 May 2026.

Pump already supports video uploads and has livestream discovery. Its documented Tokenized Agent setting concerns automated buybacks/burns and does not itself supply an AI content agent. A video attachment or vague agent branding is therefore insufficient differentiation.

Strategic inference: low creation friction supplies launches; discovery connects those launches to traders; trades fund the venue; creator rewards incentivize continued participation. Vello needs both creators and viewers/traders. Generation alone does not recreate Pump's audience or market liquidity.

## Concrete experience

Example: a creator launches an original robot chef meme. A 15-second video establishes its personality. Visitors watch, follow, suggest the next recipe, share a mint-linked video, or buy/sell through a separate trade confirmation. Later fees fund the next approved episode. Viewing and participation do not require purchase. No promised price increase.

Creator path: image/prompt -> character preview -> video preview -> inspect token/curve/fees/allocations -> sign launch -> public page and feed -> fee claims and approved episode queue.

Trader path: discover videos -> inspect mint, curve, creator holdings/authorities, liquidity and fees -> obtain current quote -> sign buy/sell -> follow the character -> return for episodes and market activity.

Reasons to choose Vello over a manual Pump launch: built-in creative continuity, launch-ready media, native video discovery, a community remix queue, and a visible fee-funded content balance. This is an adoption hypothesis. Experienced teams may prefer Pump's larger existing audience.

## Proposed pre-graduation fee model

Use a fixed 1.25% total swap fee for the first experiment, collected in the quote token. No extra front-end trade fee initially. Rates are a proposal, not deployed settings.

| Destination | Effective share of eligible volume |
| --- | --- |
| Meteora protocol | 0.25% |
| Creator | 0.30% |
| Vello operating revenue | 0.50% |
| Token content budget | 0.20% |
| Total | 1.25% |

DBC takes 20% of total trading fees for protocol. With a 1.25% fee this is 0.25%; the remaining 1.00% is split 30% creator / 70% partner. The resulting partner claim is 0.70% of eligible volume. Vello allocates that claim 5/7 operations and 2/7 content. Referral fees, if enabled, come from the protocol share rather than increasing the trader's total.

The operations/content split is not a native third DBC recipient in this proposal. Start with an explicit, auditable allocation ledger and controlled fee claims; investigate Meteora Dynamic Fee Sharing for a stronger settlement implementation. Show whether allocation is program-enforced or platform-accounted. Count content obligations separately from operating revenue.

These are approximate volume-equivalent rates; actual accounting uses on-chain fee bases, quote amounts, decimals, rounding, and claims. SOL-denominated receipts have USD price risk. Do not count token balances as realized cash.

Post-graduation is a separate design: DAMM v2 distributes fees to protocol and liquidity positions. Configure locked partner/creator position shares and claim rights, then test resulting fee income with the SDK. Do not assume DBC creator/partner percentages persist after migration. Use locked liquidity rather than a withdrawable platform liquidity position solely for revenue. Finalize and disclose graduated fees before customer launches. Vello earns only on pools and positions with its claim rights, not every trade in the token on every venue.

## Compute economics

At the proposed 0.50% operations share, $1M eligible volume yields $5,000 operating revenue; content allocation is $2,000. At $10M this is $50,000 operations and $20,000 content. This is gross allocation before RPC, storage, moderation, retries, staff, acquisition, and taxes.

At 0.20% content allocation, an actual $2 video requires roughly $1,000 eligible volume to fund; a $10 video requires $5,000. These costs are sensitivity examples, not measured pipeline costs. Measure failed renders, moderation, and revisions. Generate only when already-claimed content funds cover the reserved full render cost. Queue is rate-limited and stops at zero budget; no borrowing from future volume or liquidity reserves.

Free unlimited renders are economically unsound. Start with cheap still/storyboard previews. Include one capped launch video through either a disclosed one-time compute/setup charge or a limited launch subsidy. There is no subscription. Subsidize the first cohort under a fixed total budget and measure recovery before opening permissionlessly. A creator first buy is not platform income; only its actual fee contribution is revenue. A platform creation fee also has a Meteora protocol share that must be accounted for if used.

If 1,000 launches each consume $5 subsidized compute, that costs $5,000. Recovering this alone at 0.50% operations share requires $1M eligible volume before other costs. Most launches may contribute little: evaluate cohort revenue rather than assuming equal volume per token.

## MVP and launch

1. Days 1-14: verify one DBC configuration; character/video launch flow; token page; direct swaps; fee claims; content ledger. Measure render cost and prepare capped subsidies. Existing Vello pipeline presence is not proof of mainnet readiness.
2. Days 15-30: video discovery feed; following; approved episode generation from funded balances; route/migration monitoring; creator analytics; content moderation and rights controls. Independently review wallet transactions and fund handling before public mainnet funds.
3. Days 31-45: private mainnet cohort of 10-20 original meme artists, AI video creators, and Solana creators. Each brings an existing audience and approved source assets. Schedule releases to concentrate discovery. No volume guarantees or trader rewards based on turnover.
4. Days 46-60: publish consented case studies; open a capped launch queue; recruit community managers as creator scouts; add authorized remixes only after basic launch and fee accounting work.

GTM pitch: "Launch a meme that keeps making videos." Show image/prompt -> generated video -> live token -> new fee-funded episode. Recruit creators on X and Solana community channels; publish demos through owned accounts. Use shareable video pages with canonical mint links, not price promises. Approach Meteora builders for feedback after an end-to-end demo. Do not assume grants, endorsements, or exchange agreements.

Test both sides: creators choosing Vello over their usual launch venue, and independent viewers returning to watch/discover. Track 7-day viewer return, repeat creator launches, shared-video project visits, organic unique traders, eligible fee volume, realized net operations revenue, and per-launch subsidies. Distinguish self-trades, incentives, bots, and campaign-origin traffic. No wash-volume program.

Review gate after the first 20 launches: did creators choose Vello because of its media/discovery experience; did at least five communities publish a second funded episode; did any independent audience return; did realized fee contribution cover measured variable costs? These are proposed learning gates. If content is consumed but trading does not occur, the fee-only model is unproven. If trading exists but viewers do not return, the video differentiation is unproven.

## Market access

Meteora documents DBC integration with Jupiter and trading platforms. Check actual quote availability rather than promising immediate universal inclusion. Track direct swaps, quotes in both directions, indexing, and successful DAMM v2 migration. Fees attached to supported pool swaps can accrue when traders use external interfaces; a UI-only fee is bypassed elsewhere. Separate token metadata/verification from tradability.

Keep one sufficiently funded pool initially. Additional exchanges do not create demand and may fragment capital. CEX applications are later, discretionary listings. The launch promise is a working on-chain market with honest route status, not Binance/Coinbase acceptance.

## Sources

- https://pump.fun/docs/fees
- https://pump.fun/create
- https://pump.fun/docs/tokenized-agent-disclaimer
- https://docs.meteora.ag/core-products/dbc/fees/overview
- https://docs.meteora.ag/core-products/damm-v2/fees/overview
- https://docs.meteora.ag/core-products/dbc/migration-and-liquidity
- https://github.com/MeteoraAg/dynamic-bonding-curve

Provider behavior and rates must be rechecked before deployment. No application code or token was deployed for this strategy task.
