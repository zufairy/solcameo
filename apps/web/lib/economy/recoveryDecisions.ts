/**
 * Pure decision for a confirm-ambiguous USDC transfer whose broadcast signature
 * `getSignatureStatus` reports UNKNOWN (dropped or still-pending). This is
 * exactly the web3.js blockhash-expiry rule (getBlockHeight tip vs
 * lastValidBlockHeight), the same one confirmTransaction uses internally.
 *
 *   - "retransfer": the tx's blockhash is PROVABLY expired (current cluster tip
 *     has passed its lastValidBlockHeight), so the signature can NEVER land →
 *     re-transfer is zero-double-spend-risk.
 *   - "defer": still in-window, OR lvbh unknown (legacy row), OR the live tip
 *     couldn't be read (currentHeight null). NEVER re-transfer on uncertainty;
 *     re-annotate and try again next pass.
 *
 * Shared by the settlement / withdrawal / redemption recovery keepers — moved
 * out of the route files (Next.js forbids non-handler route exports) and kept
 * as one implementation so the money-safety rule can never drift per keeper.
 */
export function decideUnknownTransfer(args: {
  lastValidBlockHeight?: number | null;
  currentHeight: number | null;
}): "retransfer" | "defer" {
  const { lastValidBlockHeight, currentHeight } = args;
  if (lastValidBlockHeight === undefined || lastValidBlockHeight === null) return "defer";
  if (currentHeight === null) return "defer"; // couldn't read the tip
  if (currentHeight > lastValidBlockHeight) return "retransfer"; // provably expired
  return "defer"; // still within the validity window — the sig could still land
}

// Named per-keeper aliases (existing call sites + tests).
export const decideUnknownSettlement = decideUnknownTransfer;
export const decideUnknownWithdrawal = decideUnknownTransfer;
export const decideUnknownRedemption = decideUnknownTransfer;
