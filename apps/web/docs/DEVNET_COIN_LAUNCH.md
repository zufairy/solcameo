# Solana devnet coin launch

Create uses real Meteora DBC transactions: configure the curve, then create the SPL mint and pool. It requires two wallet approvals. The backend checks exact signed messages, transaction confirmation, creator, base mint, pool configuration, and minted supply before marking the coin live. The character and agent keep the same identity when the coin gets its mint address.

## Required configuration

In `apps/web/.env.local` (and the Next.js host for hosted use):

```dotenv
NEXT_PUBLIC_SOLANA_NETWORK=devnet
SOLCAMEO_DBC_RPC_URL=https://api.devnet.solana.com
SOLCAMEO_DBC_LIVE_ENABLED=false
```

A private devnet RPC can replace the public endpoint. Keep its credential on the server in `SOLCAMEO_DBC_RPC_URL`. The RPC genesis must be Solana devnet; a mainnet endpoint is rejected. Restart Next.js after environment changes, and rebuild when changing public environment variables.

Existing services also need to be configured:

- `NEXT_PUBLIC_CONVEX_URL`: the deployed database used by the app.
- `INTERNAL_CRON_SECRET`: the same value in Next.js and that Convex deployment.
- Supabase authentication and Solana wallet sign-in: prove ownership before preparing or submitting a launch.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`: writable image/metadata storage with publicly readable URLs. Portrait generation additionally uses the configured Higgsfield credentials.

Meteora DBC is already deployed on devnet (`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`). No custom program deployment or server mint wallet is required for coin creation. The connected wallet pays account rent and network fees. Generated mint/config signers are new accounts, not the user's wallet secret.

## Try it

1. Connect a Solana wallet using devnet. Obtain test SOL from https://faucet.solana.com. 0.1 SOL is a useful initial test budget, not a quoted launch cost; wallet simulation shows the actual transaction costs.
2. Open `/create`, select a portrait, name/ticker, and curve. Review and create the character.
3. The launch panel reads the live RPC/program status and your real wallet balance. Approve configuration and then token/pool creation.
4. Open the market and agent from the success dialog. Check the mint and pool on Solana Explorer with `?cluster=devnet`.

`GET /api/meteora/readiness` verifies RPC genesis, confirmed slot, and executable DBC program, and reports metadata configuration. Add `?wallet=<public-key>` for the actual wallet balance. It does not pretend to have completed a launch or test storage writes.

## Infrastructure limits

Public devnet RPC/faucet can rate limit. A dedicated devnet RPC improves reliability; never use mainnet credentials/endpoints for this test flow. Pool state comes from RPC. App trade history is confirmed trades submitted through this app; exhaustive external trade history requires a devnet indexer. Reaching graduation requires a migration transaction; Meteora's mainnet keeper must not be assumed to migrate devnet pools automatically. This launch setup does not claim that a funded, wallet-approved token was created until both transactions actually confirm.
