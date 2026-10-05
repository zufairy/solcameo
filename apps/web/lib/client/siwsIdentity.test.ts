// Wallet-scoping of the process-global SIWS session. Regression cover for the
// campaign-finalize 403 ("you do not own this resource"): a token minted for
// wallet E must NEVER be treated as the active wallet F's session — the fetch
// interceptor cross-checks getCurrentSiwsWallet() against the active wallet, and
// SiwsSessionBridge clears a stale binding when the active wallet has no stored
// session. These assert the primitives both of those rely on.
//
// Runs under the default edge-runtime env: `window` is undefined there, so only
// the in-memory mirror is exercised (the sessionStorage branches are guarded and
// no-op), which is exactly the path the interceptor reads synchronously.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearSiwsSession,
  registerEnsureSiws,
  ensureSiwsViaRegistered,
  getActiveSiwsWallet,
  getCurrentSiwsToken,
  getCurrentSiwsWallet,
  restoreSiwsSession,
  setActiveSiwsWallet,
  setSiwsSession,
  shouldAttachSiws,
} from "./siwsIdentity";

const WALLET_E = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
const WALLET_F = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
// A third, unrelated wallet — the wallet-adapter (getCurrentWalletAddress) identity,
// which on a multi-wallet Privy account can differ from the active spending wallet.
const WALLET_G = "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG";
const FUTURE = () => Date.now() + 3_600_000;

describe("siwsIdentity — wallet-scoped session binding", () => {
  // The module holds a single in-memory `current`; reset it around every test.
  beforeEach(() => clearSiwsSession());
  afterEach(() => clearSiwsSession());

  it("reports the wallet + token a session is bound to", () => {
    setSiwsSession(WALLET_E, "token-E", FUTURE());
    expect(getCurrentSiwsWallet()).toBe(WALLET_E);
    expect(getCurrentSiwsToken()).toBe("token-E");
  });

  it("restoreSiwsSession returns null for a DIFFERENT wallet and leaves the token bound to the original", () => {
    setSiwsSession(WALLET_E, "token-E", FUTURE());
    // Active wallet switches to F, which has no stored session → null. Critically,
    // the in-memory binding is NOT auto-cleared, so a stale E token would still be
    // attached unless the caller clears it (SiwsSessionBridge) or the interceptor
    // skips it on the wallet mismatch.
    expect(restoreSiwsSession(WALLET_F)).toBeNull();
    expect(getCurrentSiwsWallet()).toBe(WALLET_E); // still E — must not be sent for F
    expect(getCurrentSiwsToken()).toBe("token-E");
  });

  it("SiwsSessionBridge behavior: clearing after a no-restore drops the stale cross-wallet token", () => {
    setSiwsSession(WALLET_E, "token-E", FUTURE());
    // Mirror the bridge: no stored session for the active wallet → clear.
    if (!restoreSiwsSession(WALLET_F)) clearSiwsSession();
    expect(getCurrentSiwsToken()).toBeNull();
    expect(getCurrentSiwsWallet()).toBeNull();
  });

  it("interceptor cross-check: a token bound to E is detectably NOT the active wallet F's", () => {
    setSiwsSession(WALLET_E, "token-E", FUTURE());
    const activeWallet = WALLET_F;
    const siws = getCurrentSiwsToken();
    const siwsWallet = getCurrentSiwsWallet();
    // The interceptor attaches only when `!wallet || siwsWallet === wallet`.
    const wouldAttach = !!siws && (!activeWallet || siwsWallet === activeWallet);
    expect(wouldAttach).toBe(false);
  });

  it("happy path: a session for the ACTIVE wallet is restored and returned", () => {
    setSiwsSession(WALLET_F, "token-F", FUTURE());
    expect(restoreSiwsSession(WALLET_F)).toBe("token-F");
    const activeWallet = WALLET_F;
    const siws = getCurrentSiwsToken();
    const siwsWallet = getCurrentSiwsWallet();
    const wouldAttach = !!siws && (!activeWallet || siwsWallet === activeWallet);
    expect(wouldAttach).toBe(true);
    expect(getCurrentSiwsToken()).toBe("token-F");
  });

  it("an expired session is neither returned nor reported as bound", () => {
    setSiwsSession(WALLET_F, "token-F", Date.now() - 1); // already expired
    expect(getCurrentSiwsToken()).toBeNull();
    expect(getCurrentSiwsWallet()).toBeNull();
  });
});

describe("siwsIdentity — active spending wallet tracking", () => {
  beforeEach(() => setActiveSiwsWallet(null));
  afterEach(() => setActiveSiwsWallet(null));

  it("records and reports the active spending wallet", () => {
    expect(getActiveSiwsWallet()).toBeNull();
    setActiveSiwsWallet(WALLET_E);
    expect(getActiveSiwsWallet()).toBe(WALLET_E);
    setActiveSiwsWallet(null);
    expect(getActiveSiwsWallet()).toBeNull();
  });
});

describe("shouldAttachSiws — reconciled interceptor decision", () => {
  it("never attaches when there is no token", () => {
    expect(
      shouldAttachSiws({ token: null, siwsWallet: null, walletAddress: WALLET_E, activeWallet: WALLET_E }),
    ).toBe(false);
  });

  it("attaches when no active wallet identity is known (back-compat / wallet-only)", () => {
    expect(
      shouldAttachSiws({ token: "t", siwsWallet: WALLET_E, walletAddress: null, activeWallet: null }),
    ).toBe(true);
  });

  it("attaches when the token matches the adapter identity (getCurrentWalletAddress)", () => {
    expect(
      shouldAttachSiws({ token: "t", siwsWallet: WALLET_E, walletAddress: WALLET_E, activeWallet: WALLET_E }),
    ).toBe(true);
  });

  // THE MINT-FIX CASE: the adapter identity (walletAddress = G) diverges from the
  // Privy spending wallet the session was minted for (E). The token IS valid for the
  // wallet being minted (creatorWallet === activeWallet === E), so it must attach —
  // previously it was dropped because siwsWallet !== walletAddress, causing a
  // permanent siws_required 401 loop on mint.
  it("attaches when the token matches the ACTIVE spending wallet even though the adapter identity differs", () => {
    expect(
      shouldAttachSiws({ token: "t", siwsWallet: WALLET_E, walletAddress: WALLET_G, activeWallet: WALLET_E }),
    ).toBe(true);
  });

  // #24 REGRESSION GUARD: a genuinely stale token bound to E while BOTH the adapter
  // identity and the active spending wallet are F must NOT be attached (that was the
  // campaign-finalize 403). The request then 401s siws_required and re-mints for F.
  it("drops a stale token that matches neither the adapter identity nor the active wallet", () => {
    expect(
      shouldAttachSiws({ token: "token-E", siwsWallet: WALLET_E, walletAddress: WALLET_F, activeWallet: WALLET_F }),
    ).toBe(false);
  });

  it("end-to-end: a session minted for the active wallet attaches under divergent adapter identity", () => {
    setActiveSiwsWallet(WALLET_E);        // SiwsSessionBridge tracked the spending wallet
    setSiwsSession(WALLET_E, "token-E", FUTURE()); // ensureSiwsSession minted for it
    const attach = shouldAttachSiws({
      token: getCurrentSiwsToken(),
      siwsWallet: getCurrentSiwsWallet(),
      walletAddress: WALLET_G,           // adapter identity lags / differs
      activeWallet: getActiveSiwsWallet(),
    });
    expect(attach).toBe(true);
    clearSiwsSession();
    setActiveSiwsWallet(null);
  });
});

describe("session bridge lifecycle", () => {
  it("keeps provider recovery registered after a builder card unmounts", async () => {
    registerEnsureSiws(null);
    const provider = registerEnsureSiws(async () => "provider");
    const card = registerEnsureSiws(async () => "card");
    expect(await ensureSiwsViaRegistered()).toBe("card");
    card();
    expect(await ensureSiwsViaRegistered()).toBe("provider");
    provider();
    expect(await ensureSiwsViaRegistered()).toBeNull();
  });
});
