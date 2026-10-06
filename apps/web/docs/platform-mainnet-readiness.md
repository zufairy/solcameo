# SOLCAMEO mainnet launch readiness — 2026-10-06

Launcher implementation is local; publication has been requested but is blocked by GitHub authentication. The new platform launch page and transaction route are not published on solcameo.com.

## Verified on mainnet

Read-only Helius probe verified the mainnet genesis and executable Meteora DBC program `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` at slot 453911156. The live domain's existing readiness API also reports mainnet and configured metadata storage. The unsigned curve-configuration simulation passed on mainnet (37,388 compute units). No transaction was signed or sent.

Launch wallet: `ABiPJkc3oZACHgnLdAR6UYjXCHjnSG7ueaimZGy3DUMa`. Verified balance: **0.086438267 SOL**, above the 0.05 SOL launch minimum. Prepare **0.1 SOL**, covering the conservative 0.05 SOL launch requirement and extra fee buffer. Unspent SOL remains in the wallet. These are funding buffers, not exact protocol charges.

## Platform preset

- Existing Meteora DBC → DAMM v2 programs; no custom Solana contract deployment.
- Immutable SPL mint; 1 billion tokens; 6 base decimals; SOL quote.
- Classic market-cap curve: opens at 20 SOL market cap, graduates at 600 SOL market cap.
- SDK-computed net graduation reserve: **92.632253276 SOL**. This is contributed by trading; the creator does not need to deposit it upfront.
- 1% base curve trading fee with dynamic fees. No opening anti-sniper surcharge.
- 2% base DAMM v2 fee with dynamic fees after graduation.
- 100% graduated liquidity permanently locked; platform launch wallet owns creator and partner fee roles, subject to Meteora protocol fees.
- No initial token purchase, reserved team allocation, team vesting, agent profile or generation wallet.
- Platform revenue allocation stays 30% buybacks / 40% operations / 30% treasury. Purchases remain operator-run; holder payouts remain planned.

The defaults are based on Meteora's documented example; 100% permanent liquidity locking is a deliberate Solcameo choice. Meteora offers configurable settings rather than one universally best launch economy. Source: https://github.com/MeteoraAg/meteora-invent/blob/main/skills/meteora/references/dbc.md

## Remaining before a real launch

1. Keep at least the required launch balance in the named mainnet wallet (currently funded).
2. Publish the Next.js changes when authorized, using a mainnet build and production Convex backend.
3. Review final artwork, description, caps and fee settings in the platform interface.
4. Connect the named wallet and approve both transactions yourself.
5. Verify confirmed mint, pool, supply and permissions on chain.

SDK construction, launch guards and client recovery tests pass. A funded end-to-end mainnet launch has not been performed. The repository-wide TypeScript check still has existing errors outside this change.

Repeat the read-only check with `npx tsx scripts/check-platform-mainnet.ts` from apps/web. Add `--simulate` to validate the curve configuration against mainnet. It never signs or broadcasts.
