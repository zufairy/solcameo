import { describe, it, expect } from "vitest";
import {
  INFLIGHT_PREFIX,
  buildInflight,
  parseInflight,
  isInflight,
  isPaidSig,
  isInflightExpired,
  isClaimable,
} from "./settlementSentinel";

const REAL_SIG = "5Js9rkBASE58NoColonsOrPipes11111111111111111";
const TOKEN = "claim-token-abc";
const SIG = "BroadcastSig777";

describe("buildInflight / parseInflight round-trip", () => {
  it("round-trips a bare claim (no sig/lvbh/att)", () => {
    const s = buildInflight(TOKEN, 1_000);
    expect(s).toBe(`${INFLIGHT_PREFIX}${TOKEN}:1000`);
    const p = parseInflight(s)!;
    expect(p.token).toBe(TOKEN);
    expect(p.expiryMs).toBe(1_000);
    expect(p.confirmSig).toBeUndefined();
    expect(p.lastValidBlockHeight).toBeUndefined();
    expect(p.attempts).toBeUndefined();
  });

  it("round-trips sig + lvbh + att (the full F2 sentinel)", () => {
    const s = buildInflight(TOKEN, 42, SIG, 12345, 3);
    const p = parseInflight(s)!;
    expect(p.token).toBe(TOKEN);
    expect(p.expiryMs).toBe(42);
    expect(p.confirmSig).toBe(SIG);
    expect(p.lastValidBlockHeight).toBe(12345);
    expect(p.attempts).toBe(3);
  });

  it("round-trips sig + lvbh WITHOUT att (att=0 is omitted)", () => {
    const s = buildInflight(TOKEN, 42, SIG, 12345, 0);
    expect(s.includes("|att:")).toBe(false);
    const p = parseInflight(s)!;
    expect(p.confirmSig).toBe(SIG);
    expect(p.lastValidBlockHeight).toBe(12345);
    expect(p.attempts).toBeUndefined();
  });

  it("round-trips sig with NO lvbh (legacy confirm-ambiguous row)", () => {
    const s = buildInflight(TOKEN, 42, SIG);
    expect(s.includes("|lvbh:")).toBe(false);
    const p = parseInflight(s)!;
    expect(p.confirmSig).toBe(SIG);
    expect(p.lastValidBlockHeight).toBeUndefined();
  });

  it("preserves a token that itself contains ':' (only the LAST ':' is the expiry)", () => {
    const weird = "a:b:c";
    const s = buildInflight(weird, 99, SIG, 7);
    const p = parseInflight(s)!;
    expect(p.token).toBe(weird);
    expect(p.expiryMs).toBe(99);
    expect(p.confirmSig).toBe(SIG);
    expect(p.lastValidBlockHeight).toBe(7);
  });

  it("backward-compat: parses an OLD sentinel written without lvbh/att", () => {
    // Pre-F2 writers produced exactly `INFLIGHT:<token>:<expiry>|sig:<sig>`.
    const legacy = `${INFLIGHT_PREFIX}${TOKEN}:5000|sig:${SIG}`;
    const p = parseInflight(legacy)!;
    expect(p.token).toBe(TOKEN);
    expect(p.expiryMs).toBe(5000);
    expect(p.confirmSig).toBe(SIG);
    expect(p.lastValidBlockHeight).toBeUndefined();
    expect(p.attempts).toBeUndefined();
  });
});

describe("isPaidSig / isInflight basics", () => {
  it("a real base58 sig is paid, not inflight", () => {
    expect(isPaidSig(REAL_SIG)).toBe(true);
    expect(isInflight(REAL_SIG)).toBe(false);
  });
  it("an INFLIGHT sentinel is inflight, not paid", () => {
    const s = buildInflight(TOKEN, 1, SIG, 9, 1);
    expect(isInflight(s)).toBe(true);
    expect(isPaidSig(s)).toBe(false);
  });
  it("empty string is neither paid nor inflight (treated as not-attempted)", () => {
    expect(isPaidSig("")).toBe(false);
    expect(isInflight("")).toBe(false);
  });
  it("undefined/null is neither paid nor inflight", () => {
    expect(isPaidSig(undefined)).toBe(false);
    expect(isPaidSig(null)).toBe(false);
    expect(isInflight(undefined)).toBe(false);
  });
});

describe("F4: malformed INFLIGHT value is reclaimable, never stranded", () => {
  const NOW = 10_000;

  it("an INFLIGHT-prefixed but UNPARSEABLE value parses to null", () => {
    const bad = `${INFLIGHT_PREFIX}garbage-with-no-colon`;
    expect(parseInflight(bad)).toBeNull();
  });

  it("a malformed INFLIGHT value is treated as EXPIRED (stealable)", () => {
    const bad = `${INFLIGHT_PREFIX}garbage-no-colon`;
    expect(isInflightExpired(bad, NOW)).toBe(true);
  });

  it("a malformed INFLIGHT value is CLAIMABLE (so the keeper can recover it)", () => {
    const bad = `${INFLIGHT_PREFIX}garbage-no-colon`;
    expect(isClaimable(bad, NOW)).toBe(true);
  });

  it("a non-numeric expiry is malformed → claimable, not stuck", () => {
    const bad = `${INFLIGHT_PREFIX}${TOKEN}:not-a-number`;
    expect(parseInflight(bad)).toBeNull();
    expect(isClaimable(bad, NOW)).toBe(true);
  });

  it("empty string is claimable (not-attempted), a real sig is NOT", () => {
    expect(isClaimable("", NOW)).toBe(true);
    expect(isClaimable(undefined, NOW)).toBe(true);
    expect(isClaimable(REAL_SIG, NOW)).toBe(false); // paid → never claimable
  });
});

describe("isClaimable / isInflightExpired with a WELL-FORMED lease", () => {
  it("a live (unexpired) lease is NOT claimable; an expired one IS", () => {
    const live = buildInflight(TOKEN, 100, SIG, 5, 2);
    expect(isInflightExpired(live, 50)).toBe(false);
    expect(isClaimable(live, 50)).toBe(false);
    expect(isInflightExpired(live, 150)).toBe(true);
    expect(isClaimable(live, 150)).toBe(true);
  });
});
