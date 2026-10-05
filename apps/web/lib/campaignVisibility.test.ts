import { describe, it, expect } from "vitest";
import { isVisibleCampaign, isPickableCampaign, isFundedCampaign, isOnchainCampaign, isTerminalCampaign } from "./campaignVisibility";
import { CLIPPING_FR_ORIGIN } from "./clippingFr";

const MINE = new Set(["WALLET_ME"]);
const funded = { status: "open", pdaAddress: "VAULT1", creatorWallet: "WALLET_OTHER" };
const myDraft = { status: "open", pdaAddress: "", creatorWallet: "WALLET_ME" };
const strangersDraft = { status: "open", pdaAddress: "", creatorWallet: "WALLET_OTHER" };

// THE BUG: api.campaigns.list is unfiltered by design (crons, the oracle and admin
// panels read it), so every surface filters client-side — and they drifted. /stage
// hid unfunded drafts while the builder's Source picker showed anything with a source
// URL, so campaigns the operator had abandoned kept appearing in the dropdown.
describe("isVisibleCampaign — the /stage rule", () => {
  it("shows a funded campaign to everyone", () => {
    expect(isVisibleCampaign(funded, new Set())).toBe(true);
  });

  it("shows the viewer their OWN unfunded draft, so they can finish it", () => {
    expect(isVisibleCampaign(myDraft, MINE)).toBe(true);
  });

  it("hides a stranger's unfunded draft", () => {
    expect(isVisibleCampaign(strangersDraft, MINE)).toBe(false);
  });

  // An unknown viewer must not see unfunded drafts — funded-only is the safe side.
  it("shows funded only when the viewer is unknown", () => {
    expect(isVisibleCampaign(funded, new Set())).toBe(true);
    expect(isVisibleCampaign(myDraft, new Set())).toBe(false);
  });

  it("hides a terminal campaign even when funded — 'closed' is what 'deleted' means here", () => {
    for (const status of ["closed", "Cancelled", "completed", "deleted", "archived", "expired"]) {
      expect(isVisibleCampaign({ ...funded, status }, MINE), status).toBe(false);
    }
  });

  it("treats a missing status as live", () => {
    expect(isTerminalCampaign({})).toBe(false);
    expect(isVisibleCampaign({ pdaAddress: "V" }, new Set())).toBe(true);
  });
});

describe("isFundedCampaign", () => {
  it("needs a real vault address, not an empty string", () => {
    expect(isFundedCampaign({ pdaAddress: "VAULT" })).toBe(true);
    expect(isFundedCampaign({ pdaAddress: "  " })).toBe(false);
    expect(isFundedCampaign({ pdaAddress: null })).toBe(false);
    expect(isFundedCampaign({})).toBe(false);
  });
});

describe("isOnchainCampaign", () => {
  it("requires both a vault and finalized v2 payout rail", () => {
    expect(isOnchainCampaign({ pdaAddress: "VAULT", onchainVersion: 2 })).toBe(true);
    expect(isOnchainCampaign({ pdaAddress: "VAULT", onchainVersion: 1 })).toBe(false);
    expect(isOnchainCampaign({ pdaAddress: "VAULT" })).toBe(false);
    expect(isOnchainCampaign({ onchainVersion: 2 })).toBe(false);
  });
});

describe("isPickableCampaign — what the builder may offer", () => {
  it("matches the /stage rule", () => {
    expect(isPickableCampaign(funded, new Set())).toBe(true);
    expect(isPickableCampaign(strangersDraft, MINE)).toBe(false);
  });

  // The mirror rows exist to carry restricted rewards' plumbing and have their own
  // picker — offering one as a source is always wrong.
  it("never offers a Clipping FR mirror row", () => {
    expect(isPickableCampaign({ ...funded, origin: CLIPPING_FR_ORIGIN }, MINE)).toBe(false);
  });
});
