# SOLCAMEO platform token: operations

Policy and math live in `lib/tokenomics/platformToken.ts` (supply, allocation, tiers, revenue split). The /tokenomics page,
the billing discount and the epoch planner all read from it, so changing a number there changes everywhere.

## Pieces
- **Holder discount**: `lib/server/holderTier.ts` reads the agent owner's SOLCAMEO balance (cached 60s) and passes
  `holderDiscountPct` to `usage.recordUsage`, which clamps it to the top tier. Applies to image, Explore/motion video,
  caption and hook charges. Uses `SOLCAMEO_TOKEN_MINT` when set, otherwise the confirmed platform mint saved in Convex for the current network. Inert before launch. `run-task` skill charges are not discounted yet.
- **Epochs**: Convex cron "plan SOLCAMEO reward epoch" (Mon 00:10 UTC) calls `POST /api/tokenomics/epoch {action:"plan"}`,
  which freezes the last closed week from settled `feeSettlements` (margin = 909 bps), split 30% buyback / 40% ops / 30% treasury.
  Idempotent. `truncated` is set if a week exceeds 8000 settlements.
- **Burn** (operator): buy SOLCAMEO on the market into the treasury wallet, then
  `curl -X POST $APP/api/tokenomics/epoch -H "Authorization: Bearer $INTERNAL_CRON_SECRET" -d '{"action":"burn","epochStart":<ms>,"tokens":<n>}'`
  (dry run). Add `"execute":true` with `SOLCAMEO_EPOCH_EXECUTE=true` to broadcast. Cannot exceed the treasury balance.
- **Page data**: `GET /api/tokenomics/platform` (supply, burned, holders, vesting wallets, revenue wallet, epochs), 5s shared cache.

## Launch checklist
1. Launch the token (Meteora DBC, 1B supply). Put the mint in `SOLCAMEO_TOKEN_MINT`.
2. Create team (vesting), treasury (multisig) and rewards wallets; set the three `SOLCAMEO_*_WALLET` vars.
3. Set `SOLCAMEO_TREASURY_SECRET` (the wallet that holds bought-back tokens), deploy Convex, then the app.
4. `GET /api/health/mainnet` must show the token rows as ok.

## Not built yet
Holder reward distribution, SOLCAMEO-paired creator coins (needs devnet validation of Meteora custom quote mints),
launch burn, tier-based agent slots, automatic market buy.

## Launch interface

Open `/tokenomics/launch` from the tokenomics page. Connect and verify the wallet in `SOLCAMEO_PLATFORM_LAUNCH_WALLET` (read from the Next.js environment or the authenticated Convex owner setting; fallback: `SOLCAMEO_PLATFORM_WALLET`, then the DBC treasury public key). Only that wallet can create the official token. Review metadata and market caps, then approve configuration and pool creation. The wallet pays rent and transaction fees; no initial token purchase is made.

This is a dedicated platform fair launch, not an influencer: it creates no character, agent or generation wallet. It uses the existing immutable SPL/Meteora DBC curve, creator-only fee routing to the platform launch wallet, and permanently locked DAMM v2 liquidity. The planned 60/15/12/10/3 reserved allocation and team vesting are not implemented by this option. The interface explicitly discloses that difference.

One launch is persisted per network. Confirmed mint, pool and signature are saved and holder/tokenomics/burn features discover that mint automatically. Existing signed progress is resumable. Never change platform wallet configuration while a launch is pending. Historical frozen epochs retain their original split; new epochs use 30/40/30. Buyback purchases remain operator-run and holder payout automation is still planned.
