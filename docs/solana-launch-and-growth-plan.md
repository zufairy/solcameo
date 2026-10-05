# Vello Launch: Solana launch and growth plan

> Superseded: the user has selected a Solana-native launchpad funded through fees, with no subscriptions. The current strategy is in `solana-video-launchpad-fee-plan.md`. This document remains only as the earlier proposal.

Date: 4 October 2026. Strategy proposal, not an implemented integration.

## Decision

Build Vello Launch as a focused product powered by Vello. Sell a launch and ongoing content workflow to Solana community teams with owned IP, an existing audience, and a funded marketing budget. Support existing tokens first; add curated Meteora DBC launches after proving repeat purchases. The recurring job is producing, approving, publishing, and measuring project content. Token creation is an optional entry point.

Do not require a new platform token. Buyers pay for deliverables in USDC or ordinary payments. Their community tokens are optional speculative/community assets, not necessary for rendering videos. A character video does not establish investment value or IP ownership for holders.

## Customer and use cases

Primary buyer: a community lead or founder with an active Solana community, original mascot or licensed source material, owned publishing accounts, and at least a small recurring content budget. Qualify actual willingness to pay rather than assuming token teams have budgets.

1. Existing community token: turn its mascot, founder footage, community events, and approved announcements into a weekly content calendar. No token migration needed.
2. New creator/community launch: preview the creative identity and videos; prepare economics and disclosures; create the token and DBC pool; publish a consistent launch page and approved launch assets; continue episodes after launch.
3. Solana game or consumer app: explain real gameplay and product updates through approved short videos, with a token launch only if independently justified. This is a later segment, not the first sales pitch.

First offer: a paid 7-day campaign with one trailer, six short videos, approved captions, a canonical token/project page, and a performance report. Price test: $499. Specify format, length, render engine, revision allowance, and turnaround before accepting payment. Generated cinematic scenes and clipped source footage have different costs.

## Why choose this over manual work?

The manual alternative combines a launch site, an editor/generation tool, publishing tools, spreadsheets, analytics, and a community manager. Experienced teams may prefer it. Win when the integrated workflow measurably lowers staff time while keeping quality.

The product maintains approved source facts, the exact mint address, character identity, prior episodes, account permissions, and reusable brand assets. One approval can prepare several channel formats. Launch state changes update trading links and the project page, while publishing always requires the agreed approval policy. Attach traceable sources to factual claims. Do not generate invented partnerships, exchange announcements, holder statistics, or endorsements.

Proof targets: first approved asset in one working day; team spends under one hour per week on approvals; at least 80% of delivered assets accepted within the included revision allowance. These are validation targets, not present capabilities or promises.

## Product flow

1. Connect wallet and owned social accounts, or enter an existing token mint.
2. Provide original/authorized assets, verified links, source facts, brand rules, and campaign objective.
3. Preview a trailer and calendar with a disclosed production price.
4. Existing token: start the campaign. New token: inspect supply, allocations, authorities, curve, fees, migration threshold, LP ownership/locks, and sign the launch transaction.
5. Show confirmed mint, pool, launch state, buy/sell availability, and verified external links.
6. Approve content, publish to owned accounts, measure results, and replenish the content budget.

Start with approval-led publishing and one template per content format. A fully autonomous growth agent is unnecessary for initial proof.

## Trading access and exchange distribution

Meteora's official DBC repository describes Jupiter and trading-platform integration during the curve phase. Treat this as protocol support, not a guarantee that every new mint/configuration immediately appears in every wallet or terminal.

Lifecycle: configured DBC pool -> trading on curve -> threshold reached -> migration transaction -> DAMM v2 pool active. The application must monitor and execute/retry the required migration path or confirm a keeper handles it. Threshold completion alone is not proof that the new pool is usable. The trading UI must switch pools at migration.

Launch readiness checks:

- Pool and mint exist on-chain with the displayed authorities and economics.
- Direct DBC buy and sell paths work; transaction simulation and quotes use current state.
- Check Jupiter quotes in both directions at multiple order sizes, record price impact, and distinguish unsupported route, temporary index delay, and insufficient liquidity.
- Monitor quote freshness and avoid displaying an active buy button for an unavailable route. Offer the direct supported path when appropriate.
- Confirm DAMM v2 migration and repeat quote/route checks against the successor pool.
- Display separate statuses for tradable, externally routed, indexed, and verified.
- Check DEX Screener indexing and metadata. Its documentation says supported liquidity pools with at least one transaction are automatically listed. Indexing is neither endorsement nor exchange listing.
- Prepare accurate Jupiter verification and CoinGecko applications when eligible. Standard Jupiter verification submission is free; its paid Express submission is currently 1000 JUP. Submission does not guarantee approval.

Do not add Raydium or other secondary pools by default. More pools require more capital and may fragment shallow liquidity. Evaluate a second venue only when its users, liquidity depth, and routing justify it. Never use incentives to manufacture wash volume.

CEX listings are later applications, not an MVP deliverable. Coinbase describes independent business, technical, and due-diligence reviews. Trading demand, traction, and liquidity are assessed; a launchpad cannot guarantee acceptance. Produce a listing data pack only for teams with credible sustained activity.

## Capital and fee boundaries

Maintain separate balances for curve/liquidity reserves, creator/partner fee claims, and content/distribution budgets. Trading reserves are not production cash. Users approve content deposits and any fee-funded replenishment; budgets have spend caps and a visible ledger. Pause generation when credit runs out.

Use standard SPL token behavior and one reviewed launch template initially. Avoid transfer hooks, custom token taxes, and new financial contracts until an actual requirement justifies their compatibility and security burden.

Disclose fees and allocations before signing. If claiming fees after migration, implement the DAMM v2 position fee path separately from DBC claims. Confirm rights and amounts from on-chain configuration; do not assume fee sharing persists identically across phases.

## Pricing and economics

Proposed experiments, not validated prices:

| Offer | Price | Boundaries |
| --- | --- | --- |
| Paid pilot | $499 once | 1 trailer + 6 shorts; capped formats, lengths, revisions |
| Monthly campaign | $299/month | 12 template/source-based shorts; expensive generated scenes extra |
| Managed campaign | $999/month | Greater creative review and scheduling; explicitly capped hours/assets |
| Distribution management | 15% of external campaign spend | Creator/channel payouts passed through and separately shown |
| DBC launch | Network/setup costs plus disclosed service charge | Set price after support and transaction costs are measured |

Trading partner fees are additional variable revenue. Example only: eligible $1M volume x 0.20% platform share = $2,000. The actual eligible share depends on the configured lifecycle economics. At $50K volume the same share is $100; at zero volume it is zero. Model both phases separately and do not count creator or LP fees as platform revenue.

Example subscription contribution: $299 less $60 rendering/storage, $45 review/support, and $10 payments/other variable cost = $184, approximately 62%. These costs are a hypothesis to measure, not repository-derived actuals. Include failed generations and revisions. At that contribution, covering $5,000 monthly fixed costs requires 28 active customers before acquisition costs and taxes. Twenty customers produce $5,980 MRR and $3,680 contribution, not $5,980 profit.

For $5,000 distribution spend, 15% management revenue is $750; contractor/channel payouts are not revenue. Publishing capabilities alone do not constitute a distribution network. Recruit and test real channels before selling reach. Verify views and fraud exposure before offering performance payouts.

## Go to market

Positioning: "Your Solana launch and weekly content, in one workflow." Lead outreach with a specific creative example for that team's project and a paid, fixed-scope pilot. Do not pitch guaranteed price growth, volume, or CEX access.

First 30 qualified prospects: 15 existing community-token teams with owned mascots, 10 creators with active Solana audiences and launch intent, and 5 community managers/agencies handling several projects. Inspect recent publishing activity, available source material, and purchasing authority. Prefer teams that survived beyond launch day and still post.

Contact teams directly only under explicit messaging authorization. Offer a privately shared storyboard/mockup using authorized materials, then ask for the paid pilot. Do not publish speculative client work without permission.

Acquisition hypotheses: personalized founder outreach; demonstrations showing input, approval, finished video, and measured results; community-manager referrals; agencies buying multiple seats; integration documentation for launchpads. X and Telegram are initial channels to test, not assumed guaranteed demand. Customers should publish through accounts they own and where their audience already exists.

After three paid case studies, approach Meteora builders with a working DBC demo and route/migration evidence. Request technical feedback and potential directory exposure. Approach launchpad partners with an existing-token content integration so adoption does not require moving their token launch flow. Do not assume endorsement, grants, or partnerships.

Referral experiment: 20% of collected subscription revenue for the first three months, capped and contingent on positive contribution. No referral payout on speculative token purchases. Track source, conversion, contribution, and renewal before expanding.

## 90-day sequence and gates

| Period | Work | Decision gate |
| --- | --- | --- |
| Days 1-14 | Interview 15 qualified buyers; sell and deliver 3 paid pilots using current Vello tools | At least 3 paid pilots; measure hours, accepted assets, cost |
| Days 15-30 | Deliver 5 total pilots; add token project records, approval queue, credit accounting, simple tracked project pages | At least 3 of 5 buy another campaign; target >=60% variable contribution |
| Days 31-60 | Build one DBC config, wallet-signed launch, direct swaps, lifecycle monitor, migration recovery, Jupiter quote checks | End-to-end launch/buy/sell/migration validated; independent review before customer funds |
| Days 61-90 | Curated mainnet cohort, public case studies with consent, recruit 2 agency/channel partners | Aim for 10 paying customers and 3 active launch campaigns; report renewals and actual costs |

If paid pilots do not renew, resolve quality, targeting, or willingness-to-pay before building the launchpad. If the content service sells but customers prefer existing launch venues, continue as their content integration. If launches sell but recurring content does not, do not assume a launchpad fee will rescue the recurring product.

Metrics: collected revenue, renewal, contribution after review/retries, approval time, content acceptance, retained viewers, project-page visits, route availability, migration recovery, and customer acquisition cost. Wallet connects are not purchases. Views are not demand. Aggregate on-chain activity may be observed, but it cannot prove a video caused a trade; report attribution limits and distinguish incentivized activity.

## Implementation foundations and gaps

Reusable code: apps/web/lib/server/videoScript.ts (persona and continuity), apps/web/lib/server/renderStudioRender.ts (rendering), apps/web/lib/campaignBudget.ts (campaign constraints), existing wallet and campaign interfaces. These were inspected, not production-certified.

Missing scope: project-to-mint records; source-fact controls; scoped content budget; DBC config and SDK integration; wallet transaction UX; launch/migration reconciliation; external quote and metadata monitoring; campaign attribution; quality review and support operations. Existing minimum campaign budget behavior must be evaluated for a small pilot rather than silently changed.

Use the same engine with a dedicated Vello Launch flow. Avoid a full codebase fork. New names can be tested later: Vello Launch (recommended initial name), Vello Signal, LoreMint. Alternatives require domain, handle, and trademark checks; availability is not established.

## Sources checked

- Meteora DBC overview: https://docs.meteora.ag/core-products/dbc/what-is-dbc
- Meteora DBC program and integration support: https://github.com/MeteoraAg/dynamic-bonding-curve
- Meteora lifecycle and SDK: https://github.com/MeteoraAg/meteora-invent/blob/main/skills/meteora/references/dbc.md
- Jupiter verification: https://developers.jup.ag/docs/tokens/verification
- DEX Screener indexing: https://docs.dexscreener.com/token-listing
- CoinGecko listing prerequisites: https://support.coingecko.com/hc/en-us/articles/7291312302617-How-to-List-a-New-Cryptocurrency-on-CoinGecko
- Coinbase listing review: https://www.coinbase.com/listings
- Existing creator-fee competition: https://pump.fun/docs/fees and https://support.bags.fm/en/articles/13434876-royalty-earned

Provider rules and prices can change; recheck before implementation and launch.
