# Solcameo on Solami

Solcameo runs on Solana mainnet. [Solami](https://solami.dev) is the infrastructure underneath it: RPC for every on-chain call,
the Blur stream and REST API for the live **Solana Pulse** dashboard (`/pulse`), and Beam for transaction-landing lookups.

## Solami products used

| Product | Where | What it does for the app |
| --- | --- | --- |
| **RPC** `rpc.solami.dev/sol` | Every server and relay call, via `lib/solana/network.ts` | Balances, deposits, swaps, launches, payment verification, market sync. Admin-switchable with QuickNode. |
| **WebSocket** `ws.solami.dev/ws/sol` | `components/solstar/MarketTerminal.tsx` | Live DBC pool account subscription for the market chart. |
| **Blur realtime stream** `ws.solami.dev/data/subscribe` | `lib/solami/pulseHub.ts` | Decoded `swap`, `token_create`, `pool_create`, `liquidity`, `surge`, `graduation`, `metadata` events, aggregated into Pulse. |
| **Blur REST** `api.solami.dev/data/token/stats` | `app/api/pulse/coins/route.ts` | 5 min / 1 h / 24 h price, volume, trades, unique traders and buy/sell pressure for each live Solcameo coin. |
| **Beam landing lookup** `api.solami.dev/swqos/tx/{sig}` | `app/api/pulse/landing/route.ts` | "Did my transaction land": landed, via Jito, region, tip. |

## Pulse metrics

All computed from the Blur stream over a rolling 15 minute window (one-minute buckets, `lib/solami/pulseAggregate.ts`):
volume and trade count, **unique wallets**, **new token launches and pool creations**, **liquidity in and out** (USD, both legs),
per-token price and **buy/sell pressure**, volume by DEX, surges, graduations, large swaps. Health: stream state, events per
second, seconds behind chain, reconnects, RPC latency and slot per provider, and Beam landing lookups.

The stream is metered per byte (about 370 KB/s for the full firehose), so the server opens **one** shared socket only while
someone is viewing and closes it after 45 s without a poll.

## Switching RPC provider (admin)

`/admin/rpc` shows both providers live (status, latency, slot) and switches the whole app with one click. The choice is stored in
Convex (`rpcSettings`) and every server picks it up within about 10 seconds. The other provider stays on as automatic failover,
then Helius, then the public endpoint. Order is built in `lib/solana/network.ts` (`getRpcCandidates`, `getRpcUrl`).

## Everything that uses RPC

All of these follow the switch automatically because they resolve their endpoint through `lib/solana/network.ts`.

- **Browser relay** `app/api/solana-rpc/route.ts`: the allow-listed methods the browser needs (balances, blockhash, send, simulate,
  signature status). The provider key never reaches the browser.
- **Deposits, withdrawals, swaps**: `lib/solana/fundWallet.ts`, `lib/client/usdcClient.ts`, `lib/client/fundWithSol.ts`,
  `lib/solana/landTransaction.ts`, `lib/solana/tokenBalance.ts`, `app/api/agents/fund-swap`.
- **Payment verification**: `lib/trader/verifyUsdcDeposit.ts` (races every candidate), generation payments, x402 reconcile.
- **Launches**: `lib/server/meteoraLaunch.ts` and `lib/server/pumpLaunch.ts` (via `getDbcRpcUrl`), `lib/server/mainnetReadiness.ts`.
- **Market data**: `lib/server/marketChainSync.ts`, `lib/server/marketPosition.ts`, `lib/server/calloutTrades.ts`,
  `app/api/solstar/volume/route.ts`, `components/solstar/MarketTerminal.tsx`.
- **Escrow and vault**: `lib/escrow.ts`, `lib/agentVault.ts`.
- **Admin**: treasury and overview balances.
- **Failover**: `lib/solana/failoverConnection.ts`, `lib/solana/rpc.ts` (`rpcTry`, `rpcRace`).
- **Not switchable from the admin panel**: Convex server functions (`convex/lib/solanaVerify.ts`) read `SOLANA_RPC_URL` from the
  Convex environment, which the Next.js admin switch cannot change.

## Run it yourself

1. Create an **API key** at <https://solami.dev/dashboard/keys> and set `SOLAMI_API_KEY`.
2. Create a custom role with only the `DataApi` permission, attach it to a second key, set `SOLAMI_DATA_API_KEY`.
3. Run the app and open `/pulse` (live data) and `/admin/rpc` (provider switch). Everything else is in `.env.example`.
