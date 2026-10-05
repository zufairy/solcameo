import { describe, it, expect, afterEach, vi } from "vitest";
import { selfOrigin, selfOrigins } from "./selfOrigin";

describe("selfOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers the explicit override", () => {
    vi.stubEnv("INTERNAL_APP_URL", "https://forced.example");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "svc.up.railway.app");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vello.gg");
    expect(selfOrigin()).toBe("https://forced.example");
  });

  it("uses the railway.app host over the custom domain — its wildcard cert is always valid", () => {
    vi.stubEnv("INTERNAL_APP_URL", "");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "svc.up.railway.app");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vello.gg");
    expect(selfOrigin()).toBe("https://svc.up.railway.app");
    expect(selfOrigins()).toEqual(["https://svc.up.railway.app", "https://vello.gg", "https://velloagents.com"]);
  });

  it("ignores RAILWAY_PUBLIC_DOMAIN when Railway reports the CUSTOM domain (that is the broken cert)", () => {
    vi.stubEnv("INTERNAL_APP_URL", "");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "vello.gg");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vello.gg");
    expect(selfOrigins()).toEqual(["https://vello.gg", "https://velloagents.com"]);
  });

  // A STALE env var is the exact failure that kept dialing a retired hostname
  // after the app moved: the compiled-in canonical origin turns that into one
  // failed handshake instead of an unreachable app.
  it("always keeps the canonical production origin as a last resort", () => {
    vi.stubEnv("INTERNAL_APP_URL", "");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "");
    vi.stubEnv("RAILWAY_STATIC_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(selfOrigins()).toEqual(["https://velloagents.com"]);
    expect(selfOrigin()).toBe("https://velloagents.com");
  });
});
