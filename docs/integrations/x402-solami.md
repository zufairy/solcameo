# Vello live Solana research: Solami + agent x402 payments

Vello agents can now buy live Solana token research using x402 v2 and use the observations in their research tasks. External agents can buy the same report directly from the public API. This is a small, concrete infrastructure product: paid chain intelligence with transaction evidence, rather than a protocol badge on the existing Stripe checkout.

## What runs

- `GET /api/intelligence/solana?mint=<MAINNET_TOKEN_MINT>` negotiates an exact **0.01 USDC** x402 v2 payment and delivers a report after confirmed settlement.
- Solami Blur is the actual data path: `/data/token/stats` with explicit 300/3600/86400-second windows, plus `/data/token/trades` with a bounded 50-trade sample.
- Reports include volume, trades, unique traders, buy/sell counts, price movement, recent trade slots/signatures, and transaction evidence links. Decimal strings remain intact in the report. Buy share measures trade counts, not capital flow. An inactive/stale token does not produce a fabricated live report.
- Vello's `research` task accepts `input.solanaMint`, buys this report with the official `@x402/core` / `@x402/svm` SDK, and includes the evidence in its reasoning prompt and persisted output.
- `/intelligence` provides an owner-facing demo: set a spending policy, fund a dedicated wallet, research a mainnet token, inspect metrics, interpretation, source transactions, and settlement receipt.
- Existing generic research without `solanaMint` keeps its current behavior.

Solami itself is authenticated with a DataApi key. **This integration does not claim that Solami accepts x402.** Vello packages Solami observations into a useful research resource and accepts x402 from agents purchasing it. The report's market data always comes from Solana mainnet; its USDC payment network is configured independently.

## Setup

Requirements: Node 22, npm, an existing runnable Vello installation, Convex, Solami DataApi access, a Solana recipient wallet, and the current reasoning provider for Vello agent interpretation.

```sh
npm install
cp docs/integrations/x402-solami.env.example /tmp/vello-x402-example.env
```

Copy the relevant settings into `apps/web/.env.local` and the deployment environment. Do not overwrite existing env files. All the new variables are **server-only**. Set `INTERNAL_CRON_SECRET` to the same existing value on Next and Convex. The dedicated spending wallet uses the app's existing encrypted wallet-secret storage; production requires `WALLET_ENCRYPTION_KEY`.

Get a Solami API key with **DataApi permission** using the bounty's [seven-day Pro signup](https://solami.dev/signup?ref=st-earn-sep-26). The API key for Blur is not interchangeable with a plain RPC/gRPC key. Set `SOLAMI_API_KEY`; optionally copy the authenticated RPC URL into `SOLAMI_RPC_URL` for mainnet signing and reconciliation.

Run the existing Convex dev process to install the updated schema/functions, then start Next:

```sh
cd apps/web
npx convex dev
# In another terminal, from the repository root:
npm run dev --workspace apps/web
```

**Development payments:** use the example's Solana devnet CAIP-2 identifier, devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, and the public test facilitator. Its `/supported` endpoint was checked on 2026-10-01 and advertises exact-SVM devnet support. It does not advertise Solana mainnet support. The app also verifies facilitator support at runtime and refuses unsupported configurations.

**Mainnet payments:** [PayAI](https://facilitator.payai.network/) advertised v2 exact-SVM mainnet and devnet support in its live `/supported` response checked on 2026-10-01; it is one configurable option (`X402_FACILITATOR_URL=https://facilitator.payai.network`). Verify its current service terms and support before deployment. Set `X402_NETWORK=solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, use mainnet USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, and configure a facilitator whose `/supported` endpoint advertises v2 exact on this network. Set `X402_PAY_TO` to your actual revenue wallet. Mainnet recovery requires `SOLAMI_RPC_URL`. A static-Bearer facilitator can use `X402_FACILITATOR_BEARER_TOKEN`. CDP's per-request JWT authentication requires a dedicated auth adapter; do not paste a CDP API secret into the static token setting. Do not change networks or the recipient while signed purchases await reconciliation.

## Enable a Vello agent

For the local browser preview, use `http://localhost:3000/intelligence`. Owner login also needs the exact local origin authorized in the existing Privy app settings; this workspace currently authorizes HTTPS localhost, so use `npm run dev:https --workspace apps/web` for real owner login or configure the intended development origin. The anonymous paid API/CLI does not require Privy. A rendered preview alone does not validate authentication.

Open `/intelligence`, sign in as the agent's creator, and enter its Vello mint address. The app requires the existing Privy session and SIWS ownership proof before changing payment policy. Co-creators cannot change this wallet's spending policy.

1. Set a daily limit and enable purchases. The fixed request price is one cent; hard ceilings are $0.10/request and $1/day. The UI requests $0.01/request and defaults to $0.10/day.
2. The server creates an encrypted, dedicated x402 spending wallet. Fund its displayed address with a small amount of USDC **on the displayed payment network**. The facilitator sponsors payment transaction fees; Vello does not spend its treasury key to buy reports.
3. Enter an active Solana mainnet token mint and run research. The default is wrapped SOL.
4. Inspect the three activity windows, transaction links, agent interpretation, and x402 receipt.

These are custodial app-managed spending wallets using Vello's existing encryption mechanism, not a new noncustodial wallet product. Fund only the intended research budget. Wallet export/withdrawal and third-party provider selection are not exposed by this first integration. The wallet is isolated from investment backing and from the Stripe credit balance.

API equivalents (attach your existing Privy bearer and SIWS session; do not use the server secret from a browser):

```http
POST /api/agents/x402-policy
Content-Type: application/json
Authorization: Bearer <PRIVY_ACCESS_TOKEN>
X-Siws-Session: <OWNER_SESSION>

{"mintAddress":"<VELLO_AGENT_MINT>","enabled":true,"perRequestMicros":10000,"dailyMicros":100000}
```

Response includes `walletAddress`, `paymentNetwork`, and `usdcMint`; never its signing secret.

```http
POST /api/agents/run-task
Content-Type: application/json
Authorization: Bearer <PRIVY_ACCESS_TOKEN>
X-Siws-Session: <OWNER_SESSION>

{"mintAddress":"<VELLO_AGENT_MINT>","taskType":"research","input":{"solanaMint":"So11111111111111111111111111111111111111112","question":"What changed in this token's activity? Cite on-chain evidence."}}
```

An enabled owner policy also bounds internal research dispatches. An LLM cannot set its own budget, choose arbitrary URLs or redirect a payment recipient.

## External agent access

First inspect the challenge without paying:

```sh
curl -i 'http://127.0.0.1:3000/api/intelligence/solana?mint=So11111111111111111111111111111111111111112'
```

A configured service returns HTTP 402 plus `PAYMENT-REQUIRED`. The v2 resource URL uses `X402_RESOURCE_ORIGIN`, including the exact token query. An external agent uses the official Solana `ExactSvmScheme` client, enforces the network/USDC/recipient/one-cent policy, signs, and retries with `PAYMENT-SIGNATURE`. Success returns `PAYMENT-RESPONSE`. See the [official Solana x402 client guide](https://solana.com/docs/payments/agentic-payments/x402).

A runnable disposable demo agent is included. From `apps/web`, load the same non-public x402 settings into your shell (the script does not auto-load the app's env files):

```sh
# Inspect terms; no payment is signed or sent.
npm run x402:report -- So11111111111111111111111111111111111111112
# Explicit purchase with a disposable demo wallet, maximum $0.01 USDC.
# Set X402_DEMO_SECRET_BASE64 locally; never commit or paste the secret.
npm run x402:report -- So11111111111111111111111111111111111111112 --pay
```

The script saves the authorization to a mode-0600 `x402-demo-payment.json` before transmitting it. Repeating `--pay` with that file reuses the same payment and retrieves the original report. Use a fresh `--payment-file=<path>` only for a deliberately new purchase. The raw-key script refuses production use; Vello's production path uses its owner-policy-controlled encrypted spending wallet. Custom payment filenames must also be excluded from version control.

Keep the signed payload durably before sending it. If an attempt times out or returns 202, resend **the same payload** for recovery; do not negotiate a fresh payment. The endpoint rejects redirects, mismatched resources/prices, and unsupported networks. The agent-facing service grants a report only; payment does not authorize operations on other Vello agents.

## Commerce and recovery

There are two distinct charges:

- **0.01 USDC report payment:** paid immediately by the dedicated wallet through x402; stored in `x402Purchases` / `x402Reports` with its receipt. It is not put into Vello's compute tab or debited from credits again.
- **Existing 0.02 USDC-equivalent research reasoning charge:** keeps the existing research task/credit billing behavior. This is the interpretation work, not the report payment.

Seller report creation completes before settlement. A durable transaction-hash claim prevents two workers from settling the same payment. A paid replay returns the original report/receipt; the report keeps its original observation timestamp. Receipt fulfillment consumes the transaction signature through Vello's global replay protection, atomically with marking the report paid. It creates no signup credits or subscription entitlement.

Buyer reservations are serializable and one-per-task. Concurrent requests count toward the daily cap. Unknown signed purchases retain their cap reservation, including carryover from prior days; an unsigned attempt can release it. A signed attempt to this same Vello service can release only when a serializable mutation first writes a permanent seller cancellation record, preventing any racing or later settlement; an already-claimed or uncertain payment cannot release. Expired unsigned reservations cannot sign on a later day. Owner policy revocation blocks new signing.

A facilitator timeout or a crash after starting settlement leaves the seller record `unknown` or `settling`; **no automatic second settlement is attempted**. If a successful SDK receipt was obtained but final database fulfillment failed, the receipt is stored for fulfillment on replay. If the process died before it could persist the receipt, retrieve the signature from the facilitator's audit log, then reconcile:

```http
POST /api/internal/x402/reconcile
X-Internal-Secret: <SERVER_SECRET>
Content-Type: application/json

{"proofHash":"<HASH_FROM_202_RESPONSE>","txSignature":"<EXISTING_SETTLED_SIGNATURE>"}
```

Recovery checks the RPC genesis/network, a successful confirmed transaction, and exact equality of its transaction message to the reserved signed payment. It records the receipt and consumes the signature; it never sends USDC. Replay the original paid request afterward to retrieve the report. There is no automated release for an unknown settlement without definitive chain evidence. If Vello research failed after paying, the report/payload remains in `x402Purchases`; do not create a new task merely to recover the old report. Operator recovery can replay that stored payload at the public endpoint, then persist the response with the server-only purchase completion mutation.

A direct report purchase remains a real payment even if later interpretation fails. Do not describe an ordinary failed-task credit refund as refunding that USDC transfer.

## Bounty fit and demo

Reviewed [Build something live on Solana data](https://superteam.fun/earn/listing/build-something-live-on-solana-data), sponsored by Solami. The listing specifies:

- Meaningful use of at least one Solami product; live mainnet operation is mandatory.
- A public repo and runnable README with setup/env/key instructions.
- A 2–3 minute video or Loom of the working mainnet product.
- Useful metrics and judging on Solami usage, working demo, quality, usefulness, and creativity.

The listed pool is 3,000 USDG; the submission deadline in the page data is **2026-10-13 06:59 UTC** (14:59 Malaysia). Recheck the listing before submission. x402 is Vello's agent access/payment layer, not a requirement invented for Solami's bounty. Beam is unnecessary for a read-only research product; this integration does not claim transaction routing or a continuous gRPC/WebSocket stream.

Suggested 2–3 minute recording:

1. Show the public API challenge and the owner policy/dedicated wallet.
2. Research an actively traded mainnet token on `/intelligence`.
3. Show fresh 5m/1h/24h activity, trade evidence, and the agent's interpretation.
4. Show its x402 settlement receipt and replay behavior.
5. Show the Solami data adapter and repo setup instructions.

Before claiming bounty readiness: configure a real Solami key, run against live mainnet, complete a real payment on the intended settlement network, verify its chain receipt, make the required public repo available, and record the demo. No bounty entry has been submitted, no new funds have been transferred for testing, and no live mainnet success is claimed by the local test suite.

## Validation

```sh
npm run test --workspace apps/web -- \
  lib/server/solami.test.ts \
  lib/server/x402/config.test.ts \
  lib/server/x402/sdk.test.ts \
  convex/x402.test.ts \
  app/api/intelligence/solana/route.test.ts \
  app/api/internal/x402/reconcile/route.test.ts \
  convex/userCredits.test.ts \
  convex/creditHold.test.ts
```

Tests cover real SDK exact-SVM transaction construction/signing, header interoperability, report validation/freshness, server-side budget enforcement, global signature reuse, receipt replay, and settlement ambiguity. Solami/facilitator HTTP responses are controlled in tests; they do not prove a live mainnet run.

Sources: [Solami API docs](https://solami.dev/docs/api/get_data-token-stats), [trade schema](https://solami.dev/docs/api/get_data-token-trades), [Solana x402 v2](https://solana.com/docs/payments/agentic-payments/x402), [official x402 SDK](https://github.com/x402-foundation/x402).

Local verification on 2026-10-01: **43 selected tests passed**, new runtime files passed ESLint, and `/intelligence` rendered without client errors or horizontal overflow at desktop/mobile widths. A read-only SDK check against PayAI built mainnet exact-USDC terms; it did not settle a transaction. The full app TypeScript check reports 21 errors in unrelated existing ownership-check call sites, with none in the new integration files. Live Solami data and a completed chain payment remain unverified until credentials and wallet funding are configured.
