import { describe, expect, it } from "vitest";
import {
  deriveCampaignStatus,
  isFundedOnchain,
  isJoinableCampaign,
  isUgcCampaign,
  isJoinableUgcCampaign,
} from "./campaignLifecycle";

// Fixed clock so deadline math is deterministic.
const NOW = Date.parse("2026-07-12T00:00:00.000Z");
const PAST = "2026-01-01T00:00:00.000Z";
const FUTURE = "2026-12-31T00:00:00.000Z";

/** A funded, live, joinable campaign — the baseline every test tweaks. */
const funded = {
  status: "open",
  budget: 500,
  spentUsdc: 10,
  deadline: FUTURE,
  pdaAddress: "VaultPda1111111111111111111111111111111111",
  onchainVersion: 2,
};

describe("deriveCampaignStatus", () => {
  it("returns 'open' for a live campaign with budget remaining", () => {
    expect(deriveCampaignStatus(funded, NOW)).toBe("open");
  });

  it("returns 'ended' once the deadline is in the past (status still stored 'open')", () => {
    // THE BUG: stored status stays "open" forever, so only the derived state
    // knows this campaign is over.
    expect(deriveCampaignStatus({ ...funded, deadline: PAST }, NOW)).toBe("ended");
  });

  it("returns 'completed' when the budget is fully spent", () => {
    expect(deriveCampaignStatus({ ...funded, spentUsdc: 500 }, NOW)).toBe("completed");
    expect(deriveCampaignStatus({ ...funded, spentUsdc: 501 }, NOW)).toBe("completed");
  });

  it("honors an explicit non-open stored status if one is ever written", () => {
    expect(deriveCampaignStatus({ ...funded, status: "closed" }, NOW)).toBe("closed");
  });
});

describe("isFundedOnchain", () => {
  it("is true only with a vault AND onchainVersion >= 2", () => {
    expect(isFundedOnchain(funded)).toBe(true);
  });

  it("is false for an unfunded draft (no pdaAddress)", () => {
    expect(isFundedOnchain({ ...funded, pdaAddress: undefined })).toBe(false);
    expect(isFundedOnchain({ ...funded, pdaAddress: "" })).toBe(false);
  });

  it("is false for a legacy off-chain v1 campaign (onchainVersion < 2 / absent)", () => {
    expect(isFundedOnchain({ ...funded, onchainVersion: 1 })).toBe(false);
    expect(isFundedOnchain({ ...funded, onchainVersion: undefined })).toBe(false);
  });
});

describe("isJoinableCampaign", () => {
  it("accepts a funded, live campaign", () => {
    expect(isJoinableCampaign(funded, NOW)).toBe(true);
  });

  it("REJECTS an ended campaign even though stored status is 'open' (the reported bug)", () => {
    // This is exactly what was leaking into the builder as a "deleted/removed"
    // campaign the agent offered to join.
    expect(isJoinableCampaign({ ...funded, deadline: PAST }, NOW)).toBe(false);
  });

  it("REJECTS a budget-exhausted campaign", () => {
    expect(isJoinableCampaign({ ...funded, spentUsdc: 500 }, NOW)).toBe(false);
  });

  it("REJECTS an unfunded / off-chain campaign (must be on-chain to be joinable)", () => {
    expect(isJoinableCampaign({ ...funded, pdaAddress: undefined }, NOW)).toBe(false);
    expect(isJoinableCampaign({ ...funded, onchainVersion: 1 }, NOW)).toBe(false);
  });

  it("is category-agnostic: a funded live UGC campaign is as joinable as a clipping one", () => {
    const ugc = { ...funded, category: "ugc" };
    const clipping = { ...funded, category: "clipping" };
    expect(isJoinableCampaign(ugc, NOW)).toBe(true);
    expect(isJoinableCampaign(clipping, NOW)).toBe(true);
  });
});

describe("isUgcCampaign / isJoinableUgcCampaign (AI influencer gate)", () => {
  it("isUgcCampaign is true only for category 'ugc'", () => {
    expect(isUgcCampaign({ ...funded, category: "ugc" })).toBe(true);
    expect(isUgcCampaign({ ...funded, category: "UGC" })).toBe(true); // case-insensitive
    expect(isUgcCampaign({ ...funded, category: "clipping" })).toBe(false);
    expect(isUgcCampaign({ ...funded, category: undefined })).toBe(false);
    expect(isUgcCampaign({ ...funded, category: "web3" })).toBe(false);
  });

  it("isJoinableUgcCampaign requires BOTH ugc AND joinable", () => {
    const ugc = { ...funded, category: "ugc" };
    expect(isJoinableUgcCampaign(ugc, NOW)).toBe(true);
    // A funded, live CLIPPING campaign is NOT joinable by an influencer.
    expect(isJoinableUgcCampaign({ ...funded, category: "clipping" }, NOW)).toBe(false);
    // A UGC campaign that has ended is still rejected.
    expect(isJoinableUgcCampaign({ ...ugc, deadline: PAST }, NOW)).toBe(false);
    // A UGC campaign that isn't funded on-chain is rejected.
    expect(isJoinableUgcCampaign({ ...ugc, pdaAddress: undefined }, NOW)).toBe(false);
  });
});
