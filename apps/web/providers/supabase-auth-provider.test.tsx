// @vitest-environment node
import React, { type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ authenticated: true, ready: true, login: vi.fn(), logout: vi.fn(), token: vi.fn() }));
vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: ({ children }: { children: ReactNode }) => children,
  usePrivy: () => ({ ...auth, getAccessToken: auth.token }),
  useLogin: () => ({ login: auth.login }),
}));
vi.mock("@privy-io/react-auth/solana", () => ({ toSolanaWalletConnectors: () => [], useWallets: () => ({ wallets: [] }) }));
vi.mock("@/lib/privy", () => ({ PRIVY_APP_ID: "test", PRIVY_CLIENT_ID: undefined }));
vi.mock("convex/react", () => ({ useAction: () => vi.fn() }));
import { SupabaseAuthProvider, useSupabaseAuth } from "./supabase-auth-provider";
function mount() {
  let value!: ReturnType<typeof useSupabaseAuth>;
  function Probe() { value = useSupabaseAuth(); return null; }
  renderToString(<SupabaseAuthProvider><Probe /></SupabaseAuthProvider>);
  return value;
}
afterEach(() => { vi.clearAllMocks(); auth.authenticated = true; auth.ready = true; });
describe("account sign-in", () => {
  it("preserves a signed-in account while its embedded wallet is provisioning", async () => {
    auth.token.mockResolvedValue("valid");
    const session = mount(); session.login(); session.promptLogin();
    await vi.waitFor(() => expect(auth.token).toHaveBeenCalledTimes(2));
    expect(auth.logout).not.toHaveBeenCalled(); expect(auth.login).not.toHaveBeenCalled();
  });
  it("opens account sign-in for a signed-out user", () => {
    auth.authenticated = false;
    mount().promptLogin();
    expect(auth.login).toHaveBeenCalledTimes(1); expect(auth.logout).not.toHaveBeenCalled();
  });
  it("waits for Privy to restore the saved session", () => {
    auth.authenticated = false; auth.ready = false;
    mount().login(); expect(auth.login).not.toHaveBeenCalled();
  });
  it("recovers an expired session only on explicit sign-in", async () => {
    auth.token.mockResolvedValue(null); auth.logout.mockResolvedValue(undefined);
    mount().login(); await vi.waitFor(() => expect(auth.login).toHaveBeenCalledTimes(1));
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });
  it("does not log out a user on a token-refresh network error", async () => {
    auth.token.mockRejectedValue(new Error("offline"));
    mount().login(); await vi.waitFor(() => expect(auth.token).toHaveBeenCalledTimes(1));
    expect(auth.logout).not.toHaveBeenCalled(); expect(auth.login).not.toHaveBeenCalled();
  });
});
