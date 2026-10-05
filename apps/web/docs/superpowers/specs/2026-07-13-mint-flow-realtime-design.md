# Realtime, resilient agent-mint flow

**Date:** 2026-07-13
**Status:** Approved
**Scope:** Builder page NFT mint (AI influencer + AI clipper — one shared card)

## Problem

`NftMintCard.handleMint` runs a 3–4 step chain — balance check → SIWS sign-in →
pay fee → backend mint — but exposes only a single `verifying` state (one
"Minting…" spinner). For a paid mint that is **two** wallet popups behind one
spinner, and any failure (declined signature, RPC blip, slow/timed-out backend)
collapses into one generic red error box. Observed symptoms: "generic Mint
failed error" and "wallet popup issues."

Root causes:
1. **No step visibility** — user can't tell which step is running or which
   failed; every failure looks identical.
2. **Server timeout risk** — the POST is capped at 60s but awaits
   `generateAgentDescription` (KIE/Gemini) *before* the on-chain mint with **no
   timeout**; a slow Gemini call can push the request past 60s → generic 500.

## Non-goals

- No change to payment / fee / replay-protection / SIWS logic (byte-identical).
- No visual redesign of the card, overlay, or celebration.
- No change to the server mint/vault ordering beyond bounding one call.

## Design

### 1. Client step machine (`components/builder/NftMintCard.tsx`)

Introduce an ordered step model the user watches live. Steps (paid mint):

| id       | label              | shown when        |
|----------|--------------------|-------------------|
| `signin` | Signing you in     | always            |
| `pay`    | Paying mint fee    | `activeQuote.feeUsdc > 0` |
| `mint`   | Minting on-chain   | always            |
| `finish` | Finishing up       | always            |

- Each step renders pending (dim) → active (spinner) → done (green check, framer
  pop). A thin progress bar reflects completed/total.
- `handleMint` sets the active step before each phase and marks it done after.
  The existing phase code (balance preflight, `ensureSiwsSession`, `payMintFee`,
  POST) is **unchanged internally** — only wrapped with step-state updates.
- On failure: the active step turns red with the error's *specific* message
  (SIWS/payment hooks already produce good copy). "Try again" re-runs
  `handleMint`, which resumes cheaply — completed on-chain payment is reused via
  the existing localStorage signature cache, SIWS via its session cache.
- Wallet rejection (`4001` / "rejected" / "declined" / "closed") renders a calm
  **amber** "You cancelled the wallet prompt — tap to retry", not a red error.

Preserved states: `insufficient` (add-funds panel), `done` (success + View my
agents), the fee display, avatar cycling. `MintState` gains no new *terminal*
states; the step detail is tracked in parallel state so the existing
`done`/`error`/`insufficient` branches keep working.

### 2. Error classifier (`lib/builder/mintErrors.ts`) — new, tested

```ts
type MintErrorKind = "declined" | "network" | "funds" | "server";
function classifyMintError(err: unknown): { kind: MintErrorKind; message: string };
```

Pure function, no imports from React. Maps raw errors to a kind (drives
amber-vs-red + copy) and a cleaned message. Unit-tested with vitest for each
kind (declined 4001, "User rejected", blockhash/expired → network, insufficient
→ funds, generic → server).

### 3. Server timeout (`app/api/nft/mint/route.ts`)

Wrap the `fetch(KIE_GEMINI …)` inside `generateAgentDescription` in an 8s
`AbortController` timeout. On abort/any error it already returns `null` and the
caller falls back to the deterministic description — so bounding it only removes
the hang; behavior on success is unchanged.

## Testing

- `lib/builder/mintErrors.test.ts` — classifier truth table (vitest).
- Typecheck changed files (baseline tsc already has unrelated errors — assert no
  *new* ones in touched files).
- Manual/verify: drive the mint card, confirm steps advance, decline a popup and
  confirm amber-retry resumes without double-charge.

## Files

- `components/builder/NftMintCard.tsx` — step machine + animated progress (bulk)
- `lib/builder/mintErrors.ts` + `.test.ts` — new
- `app/api/nft/mint/route.ts` — 8s timeout around the KIE description call
