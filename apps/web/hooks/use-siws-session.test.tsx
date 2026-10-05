// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { clearSiwsSession, setSiwsSession } from "@/lib/client/siwsIdentity";

const wallet = vi.hoisted(() => ({ address: "wallet-a", sign: vi.fn() }));
vi.mock("@/hooks/use-solana-wallet", () => ({
  useUnifiedSolanaWallet: () => ({ publicKey: { toBase58: () => wallet.address }, signMessage: wallet.sign }),
}));
vi.mock("@/lib/client/e2eBypass", () => ({ getE2eBypassSession: () => null }));
import { useSiwsSession } from "./use-siws-session";

/** Routes mocked responses by URL: the popup-free /auto endpoint is NOT eligible unless a test opts in. */
function routeFetch(handlers: Record<string, () => Response>) {
  return vi.fn(async (url: string) => (handlers[url] ?? (() => new Response("{}", { status: 403 })))());
}
function mount() {
  let ensure!: (opts?: { silent?: boolean; force?: boolean }) => Promise<string | null>;
  function Probe() { ensure = useSiwsSession().ensureSiwsSession; return null; }
  renderToString(createElement(Probe));
  return ensure;
}
afterEach(() => { clearSiwsSession(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("shared wallet session recovery", () => {
  it("shares one signature across independent builder components and the fetch bridge", async () => {
    wallet.sign.mockResolvedValue(new Uint8Array(64));
    const fetch = routeFetch({
      "/api/auth/siws/nonce": () => Response.json({ nonce: "nonce", message: "challenge" }),
      "/api/auth/siws/verify": () => Response.json({ session: "session", exp: Date.now() + 60000 }),
    });
    vi.stubGlobal("fetch", fetch);
    const a = mount(); const b = mount();
    expect(await Promise.all([a(), b(), a()])).toEqual(["session", "session", "session"]);
    expect(wallet.sign).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(3); // auto (not eligible) + nonce + verify
    expect(await b()).toBe("session");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("uses an existing session without signing or making an API call", async () => {
    setSiwsSession(wallet.address, "existing", Date.now() + 60000);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await mount()()).toBe("existing");
    expect(fetch).not.toHaveBeenCalled(); expect(wallet.sign).not.toHaveBeenCalled();
  });
  it("releases a rejected recovery so an explicit retry can succeed", async () => {
    wallet.sign.mockRejectedValueOnce(new Error("User rejected"))
      .mockResolvedValueOnce(new Uint8Array(64));
    const fetch = routeFetch({
      "/api/auth/siws/nonce": () => Response.json({ nonce: "one", message: "challenge" }),
      "/api/auth/siws/verify": () => Response.json({ session: "retry", exp: Date.now() + 60000 }),
    });
    vi.stubGlobal("fetch", fetch);
    await expect(mount()()).rejects.toThrow("declined");
    expect(await mount()()).toBe("retry");
  });
  it("auto-approves a Privy-linked wallet with a single request and no signature prompt", async () => {
    const fetch = routeFetch({ "/api/auth/siws/auto": () => Response.json({ session: "auto", exp: Date.now() + 60000 }) });
    vi.stubGlobal("fetch", fetch);
    expect(await mount()()).toBe("auto");
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("silent mode never prompts: it returns null when the wallet needs a signature", async () => {
    const fetch = routeFetch({});
    vi.stubGlobal("fetch", fetch);
    expect(await mount()({ silent: true })).toBeNull();
    expect(wallet.sign).not.toHaveBeenCalled();
  });
  it("force renews a session that is still valid", async () => {
    setSiwsSession(wallet.address, "old", Date.now() + 60000);
    vi.stubGlobal("fetch", routeFetch({ "/api/auth/siws/auto": () => Response.json({ session: "fresh", exp: Date.now() + 120000 }) }));
    expect(await mount()({ force: true })).toBe("fresh");
  });
});
