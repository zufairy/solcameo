import { afterEach, describe, expect, it } from "vitest";
import { publicOrigin } from "./publicOrigin";

const req = (headers: Record<string, string>, origin = "https://0.0.0.0:3000") =>
  ({ headers: new Headers(headers), nextUrl: { origin } });

afterEach(() => { delete process.env.X_REDIRECT_URI; delete process.env.NEXT_PUBLIC_APP_URL; });

describe("publicOrigin", () => {
  it("prefers forwarded host/proto over the internal bind address", () => {
    expect(publicOrigin(req({ "x-forwarded-host": "solcameo.com", "x-forwarded-proto": "https" }))).toBe("https://solcameo.com");
  });
  it("falls back to the registered X redirect URI origin", () => {
    process.env.X_REDIRECT_URI = "https://solcameo.com/api/social/x/callback";
    expect(publicOrigin(req({}))).toBe("https://solcameo.com");
  });
  it("never returns 0.0.0.0 when a public candidate exists", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    expect(publicOrigin(req({}))).toBe("https://app.example.com");
  });
  it("uses the request origin on localhost dev", () => {
    expect(publicOrigin(req({}, "http://localhost:3000"))).toBe("http://localhost:3000");
  });
});
