import { describe, it, expect } from "vitest";
import {
  selectActiveWallet,
  getLoginWalletAddress,
  isOwnerWallet,
  unionWalletAddresses,
  type SelectableWallet,
} from "./activeWallet";

const SOLFLARE = "So1f1areAddr1111111111111111111111111111111";
const PHANTOM = "Phantom2ddr2222222222222222222222222222222";
const EMBEDDED = "Embedded3ddr333333333333333333333333333333";

const embedded = (address: string): SelectableWallet => ({ address, walletClientType: "privy" });
const external = (address: string, clientType = "phantom"): SelectableWallet => ({
  address,
  walletClientType: clientType,
});

describe("selectActiveWallet", () => {
  it("returns null when there are no wallets", () => {
    expect(selectActiveWallet([])).toBeNull();
    expect(selectActiveWallet(undefined)).toBeNull();
  });

  it("returns the only wallet regardless of type", () => {
    const emb = embedded(EMBEDDED);
    expect(selectActiveWallet([emb])).toBe(emb);
    const ext = external(PHANTOM);
    expect(selectActiveWallet([ext])).toBe(ext);
  });

  it("picks the wallet matching the login address even when several are connected", () => {
    // THE bug: Solflare is the login wallet but Phantom is also connected and
    // comes first. We must pick Solflare by address, never Phantom.
    const phantom = external(PHANTOM);
    const solflare = external(SOLFLARE, "solflare");
    expect(selectActiveWallet([phantom, solflare], SOLFLARE)).toBe(solflare);
    expect(selectActiveWallet([solflare, phantom], SOLFLARE)).toBe(solflare);
  });

  it("matches the login address against an embedded wallet too (Google user)", () => {
    const emb = embedded(EMBEDDED);
    const phantom = external(PHANTOM);
    expect(selectActiveWallet([phantom, emb], EMBEDDED)).toBe(emb);
  });

  it("falls back to the external wallet over embedded when no login address given", () => {
    const emb = embedded(EMBEDDED);
    const ext = external(PHANTOM);
    expect(selectActiveWallet([emb, ext])).toBe(ext);
    expect(selectActiveWallet([ext, emb])).toBe(ext);
  });

  it("falls back to the first usable wallet when the login address isn't connected", () => {
    const phantom = external(PHANTOM);
    expect(selectActiveWallet([phantom], SOLFLARE)).toBe(phantom);
  });

  it("skips entries without an address", () => {
    const noAddr: SelectableWallet = { walletClientType: "phantom" };
    const ext = external(PHANTOM);
    expect(selectActiveWallet([noAddr, ext])).toBe(ext);
  });
});

describe("getLoginWalletAddress", () => {
  it("returns null for an empty / missing user", () => {
    expect(getLoginWalletAddress(null)).toBeNull();
    expect(getLoginWalletAddress(undefined)).toBeNull();
    expect(getLoginWalletAddress({})).toBeNull();
  });

  it("returns the linked Solana wallet address", () => {
    expect(
      getLoginWalletAddress({
        linkedAccounts: [{ type: "wallet", chainType: "solana", address: SOLFLARE }],
      }),
    ).toBe(SOLFLARE);
  });

  it("ignores non-Solana / non-wallet linked accounts", () => {
    expect(
      getLoginWalletAddress({
        linkedAccounts: [
          { type: "google_oauth" },
          { type: "wallet", chainType: "ethereum", address: "0xabc" },
          { type: "wallet", chainType: "solana", address: SOLFLARE },
        ],
      }),
    ).toBe(SOLFLARE);
  });

  it("prefers the MOST RECENTLY verified wallet when several are linked", () => {
    expect(
      getLoginWalletAddress({
        linkedAccounts: [
          { type: "wallet", chainType: "solana", address: PHANTOM, latestVerifiedAt: "2024-01-01T00:00:00Z" },
          { type: "wallet", chainType: "solana", address: SOLFLARE, latestVerifiedAt: "2024-06-01T00:00:00Z" },
        ],
      }),
    ).toBe(SOLFLARE);
  });

  it("handles Date objects for latestVerifiedAt", () => {
    expect(
      getLoginWalletAddress({
        linkedAccounts: [
          { type: "wallet", chainType: "solana", address: PHANTOM, latestVerifiedAt: new Date("2024-01-01") },
          { type: "wallet", chainType: "solana", address: SOLFLARE, latestVerifiedAt: new Date("2024-06-01") },
        ],
      }),
    ).toBe(SOLFLARE);
  });

  it("falls back to the primary verified Solana wallet", () => {
    expect(getLoginWalletAddress({ wallet: { address: EMBEDDED, chainType: "solana" } })).toBe(EMBEDDED);
  });

  it("does not fall back to a non-Solana primary wallet", () => {
    expect(getLoginWalletAddress({ wallet: { address: "0xabc", chainType: "ethereum" } })).toBeNull();
  });
});

describe("isOwnerWallet", () => {
  // Regression for the agent-edit page comparing a raw wallet-adapter publicKey
  // (null for Privy embedded-wallet users) against creatorWallet. Using the
  // unified wallet's resolved address here must match.
  it("returns true when the active address equals the owner wallet", () => {
    expect(isOwnerWallet(SOLFLARE, SOLFLARE)).toBe(true);
  });

  it("returns false when the active address differs from the owner wallet", () => {
    expect(isOwnerWallet(SOLFLARE, PHANTOM)).toBe(false);
  });

  it("returns false when there is no active address (disconnected / embedded-wallet miss)", () => {
    expect(isOwnerWallet(null, SOLFLARE)).toBe(false);
    expect(isOwnerWallet(undefined, SOLFLARE)).toBe(false);
  });

  it("returns false when the owner wallet is missing", () => {
    expect(isOwnerWallet(SOLFLARE, null)).toBe(false);
    expect(isOwnerWallet(SOLFLARE, undefined)).toBe(false);
  });

  it("is case-sensitive (Solana addresses are base58, not normalized)", () => {
    expect(isOwnerWallet(SOLFLARE, SOLFLARE.toLowerCase())).toBe(false);
  });

  // BUG-021: campaign-detail computed isBrand from the raw wallet-adapter
  // publicKey (null for embedded-wallet logins), so an embedded-wallet OWNER
  // failed isBrand ⇒ canManage=false on their own campaign. Passing the unified
  // wallet's resolved address (EMBEDDED here) against the creatorWallet fixes it.
  it("recognizes an embedded-wallet owner of their own campaign (BUG-021)", () => {
    expect(isOwnerWallet(EMBEDDED, EMBEDDED)).toBe(true);
    // A raw-adapter null (the pre-fix value for that same user) does NOT.
    expect(isOwnerWallet(null, EMBEDDED)).toBe(false);
  });
});

describe("unionWalletAddresses", () => {
  // BUG-006: Studio scoped owned agents by the single active wallet
  // (listByCreator) instead of the full linked-wallet union /wallet uses
  // (listByCreators), so an operator whose active wallet != minting wallet
  // saw an empty/partial list. This is the selector Studio must use instead.
  it("returns an empty array when nothing is linked or active", () => {
    expect(unionWalletAddresses(undefined, null)).toEqual([]);
    expect(unionWalletAddresses([], null)).toEqual([]);
  });

  it("includes the active wallet even when it isn't in the linked list", () => {
    expect(unionWalletAddresses([], SOLFLARE)).toEqual([SOLFLARE]);
  });

  it("finds an agent minted under a linked wallet that differs from the active one", () => {
    // The exact multi-wallet-operator scenario: minted under SOLFLARE, but the
    // session's active wallet is now PHANTOM. Both must be in the union so
    // listByCreators({ creatorWallets }) still returns the SOLFLARE-minted agent.
    const result = unionWalletAddresses([SOLFLARE], PHANTOM);
    expect(result).toContain(SOLFLARE);
    expect(result).toContain(PHANTOM);
    expect(result).toHaveLength(2);
  });

  it("dedupes when the active wallet is already in the linked list", () => {
    expect(unionWalletAddresses([SOLFLARE, PHANTOM], SOLFLARE)).toEqual([SOLFLARE, PHANTOM]);
  });

  it("ignores null/undefined/empty entries in the linked list", () => {
    expect(unionWalletAddresses([null, undefined, "", SOLFLARE], null)).toEqual([SOLFLARE]);
  });

  it("omits the active slot entirely when there is no active wallet", () => {
    expect(unionWalletAddresses([SOLFLARE, PHANTOM], undefined)).toEqual([SOLFLARE, PHANTOM]);
  });
});
