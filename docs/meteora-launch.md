# Meteora launch workspace

`/market` defaults to four-column charcoal/coral cards and all networks. Convex drives created-token identities, videos, and paper-ledger statistics. DBC cards and detail pages fetch confirmed pool state every 15 seconds; API responses cache for 10 seconds. Migrated DBC prices are withheld until a DAMM v2 price source is integrated. No synthetic on-chain OHLC, volume, or holder counts are displayed. Token-detail ticker strip is hidden.

`/create` reuses the existing character generator, then separates coin identity, curve economics, and final review. Curve charts and initial-buy examples come from the installed Meteora SDK's builders and simulated swap quotes. Curve inputs use SOL. Market cards and terminals display USD estimates using the Coinbase SOL-USD spot rate; devnet valuations are illustrative and test tokens have no monetary value.

## Launch choices

- Fixed 1 billion SPL tokens, 6 decimals; immutable metadata/token authority.
- SOL quote pair; 30 SOL opening cap by default, 250 SOL graduation cap.
- Classic constant-product curve, or weighted segments: steady (8..23), rocket (16..1), whale wall (1..16).
- Fixed 0.25%, 1%, or 2% trading fee, same selected tier after graduation; dynamic fees disabled.
- Creator/partner fee allocation: 100% creator. Meteora protocol fees remain separate.
- DAMM v2 migration; 100% permanently locked creator liquidity, retaining fee-claim rights.
- 1,000 tokens are a small SDK rounding buffer (0.0001% of supply), withdrawable by creator after migration.
- No initial buy, automatic AI spending, or holder reward distribution.

## Server configuration

Use existing `NEXT_PUBLIC_SOLANA_NETWORK` and RPC configuration. Optionally set `SOLCAMEO_DBC_RPC_URL` to a dedicated endpoint for that same cluster. `INTERNAL_CRON_SECRET` signs wallet-bound, network-bound receipts. Devnet is available when these requirements are met. Mainnet additionally requires `SOLCAMEO_DBC_LIVE_ENABLED=true`. Do not switch the application's network just to enable this flow; follow the repository's network rollout rules.

The wallet approves two transactions: config creation, then token/pool creation. New config/mint account keypairs and signed transaction receipts are saved in session storage for recovery; the connected wallet's private key is never accessed. Keep the tab open until complete. Configuration rent is already spent if the user stops after the first approval; it is not an atomic two-transaction launch.

The API rechecks ownership, rejects changes to reviewed messages, reserves a unique mint, verifies exact confirmed messages and pool creator on chain, and finalizes idempotently. Recovery looks up an existing signed signature before allowing an expired transaction to be rebuilt. The onboarding defaults to an on-chain launch. Completion requires confirmed pool creation and a nonzero SPL token supply with six decimals. Existing paper coins have an owner-only launch/resume action on their market page.

Mainnet spending was not exercised during implementation. Browser and unit/API tests do not replace a funded devnet rehearsal. Devnet DBC buy/sell tickets now quote the real pool, require wallet approval, and submit the exact reviewed transaction. Signed receipts bind the wallet, amount, side, and transaction message. Pending trades retain their signed packet for safe confirmation/resubmission. Actual wallet changes and network fees come from confirmed transaction metadata. App-confirmed trades refresh pool valuations and contribute observed prices and app-only 24-hour volume; this is not a full external-trade index. Fee claims and successor DAMM v2 routing remain separate integrations.

No additional platform launch fee is configured: launch transactions deduct Solana account rent and network fees, while swaps deduct the configured trading fees. A separate platform fee requires an amount and recipient wallet. The independent funded rehearsal could not complete because the devnet faucet rejected the funding request; no user funds were spent during verification.

Official sources:
- https://github.com/MeteoraAg/dynamic-bonding-curve-sdk/blob/main/packages/dynamic-bonding-curve/docs.md
- https://github.com/MeteoraAg/dynamic-bonding-curve-sdk/blob/main/packages/dynamic-bonding-curve/README.md
- https://github.com/MeteoraAg/meteora-invent/blob/main/skills/meteora/references/dbc.md
