/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { appFetch, appOrigins, isConnectPhaseError, resetOriginCache } from "./appFetch";

// The exact string Convex's Rust fetch produced when Railway served its
// *.up.railway.app wildcard cert for the custom domain.
const TLS_ERR =
  "error sending request for url (https://vello.gg/api/video/download): client error (Connect): " +
  "error:1000007D:SSL routines:OPENSSL_internal:CERTIFICATE_VERIFY_FAILED:/cache/cargo/registry/src/index.crates.io/x.rs";

describe("isConnectPhaseError", () => {
  it("treats a TLS cert verification failure as connect-phase (retryable)", () => {
    expect(isConnectPhaseError(new Error(TLS_ERR))).toBe(true);
  });

  it("unwraps Node's bare 'fetch failed' and reads the real cause (hostname/cert mismatch)", () => {
    const wrapped = new TypeError("fetch failed", {
      cause: new Error("Hostname/IP does not match certificate's altnames: Host: vello.gg. is not in the cert's altnames: DNS:*.up.railway.app"),
    });
    expect(isConnectPhaseError(wrapped)).toBe(true);
  });

  it("treats DNS/refused failures as connect-phase", () => {
    expect(isConnectPhaseError(new Error("ECONNREFUSED"))).toBe(true);
    expect(isConnectPhaseError(new Error("dns error: failed to lookup address"))).toBe(true);
  });

  it("does NOT retry an abort/timeout — the request already reached the server", () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    expect(isConnectPhaseError(abort)).toBe(false);
    expect(isConnectPhaseError(new Error("timed out after 290000ms"))).toBe(false);
  });
});

describe("appOrigins", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("puts INTERNAL_APP_URL first, then the caller-supplied origin, then env", () => {
    vi.stubEnv("INTERNAL_APP_URL", "https://internal.example");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vello.gg");
    expect(appOrigins("https://svc.up.railway.app")).toEqual([
      "https://internal.example",
      "https://svc.up.railway.app",
      "https://vello.gg",
      "https://velloagents.com",
    ]);
  });

  it("prefers a railway.app fallback over the custom domain (wildcard cert always valid)", () => {
    vi.stubEnv("INTERNAL_APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vello.gg");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://svc.up.railway.app");
    expect(appOrigins()).toEqual(["https://svc.up.railway.app", "https://vello.gg", "https://velloagents.com"]);
  });

  it("normalizes and dedupes (trailing slash, missing scheme)", () => {
    vi.stubEnv("INTERNAL_APP_URL", "vello.gg");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vello.gg/");
    expect(appOrigins()).toEqual(["https://vello.gg", "https://velloagents.com"]);
  });
});

describe("appFetch failover", () => {
  beforeEach(() => {
    resetOriginCache();
    vi.stubEnv("INTERNAL_APP_URL", "https://svc.up.railway.app");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vello.gg");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falls through to the next origin when the first fails TLS verification", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://svc.up.railway.app")) throw new Error(TLS_ERR);
      return { ok: true, status: 200, url } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await appFetch("/api/video/download", { method: "POST" });

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "https://svc.up.railway.app/api/video/download",
      "https://vello.gg/api/video/download",
    ]);
  });

  it("reuses the origin that worked instead of re-paying the failed handshake", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://svc.up.railway.app")) throw new Error(TLS_ERR);
      return { ok: true, status: 200, url } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await appFetch("/a", {});
    fetchMock.mockClear();
    await appFetch("/b", {});

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["https://vello.gg/b"]);
  });

  it("does NOT re-send on an abort — a POST must never double-execute", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const fetchMock = vi.fn(async () => { throw abort; });
    vi.stubGlobal("fetch", fetchMock);

    await expect(appFetch("/api/video/download-start", { method: "POST" })).rejects.toThrow("aborted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails with an actionable cert message when every origin is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(TLS_ERR); }));

    await expect(appFetch("/api/video/download", { method: "POST" })).rejects.toThrow(
      /certificate is invalid[\s\S]*INTERNAL_APP_URL/,
    );
  });

  // THE STALE-ENV CASE: the Convex env still pointed at the retired vello.gg long
  // after the app moved, so every hop died at CERTIFICATE_VERIFY_FAILED. With the
  // canonical origin compiled in, that same stale env now just costs one failed
  // handshake.
  it("recovers when the env still names a retired domain", async () => {
    vi.stubEnv("INTERNAL_APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vello.gg");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://vello.gg")) throw new Error(TLS_ERR);
      return { ok: true, status: 200, url } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await appFetch("/api/video/download", { method: "POST" });

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "https://vello.gg/api/video/download",
      "https://velloagents.com/api/video/download",
    ]);
  });

  it("errors clearly when no origin resolves at all", async () => {
    vi.stubEnv("INTERNAL_APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(appFetch("/x", {})).rejects.toThrow(/cannot reach the app/);
  });
});
