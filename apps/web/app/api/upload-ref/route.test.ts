// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Regression for H05/BUG-028: /api/upload-ref had NO authentication — any
// anonymous caller could host arbitrary images on Vello's PUBLIC Supabase bucket
// forever. It must now require a valid session (Privy Bearer) OR the internal
// secret, exactly like its image-handling siblings (generate-nft-images, etc.).
//
// We drive the REAL requireInternalOrUserAuth (no mock): a request with no
// Authorization header and no internal secret must be rejected with 401 BEFORE
// any Supabase upload work runs.

type RouteModule = { POST: (req: NextRequest) => Promise<Response> };

const makeReq = (headers: Record<string, string>) =>
  new NextRequest("https://vello.gg/api/upload-ref", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ base64: "AAAA" }),
  });

beforeEach(() => {
  // No internal secret configured for the request → the only way in is a Bearer.
  delete process.env.E2E_AUTH_BYPASS;
});

describe("POST /api/upload-ref — authentication gate", () => {
  it("rejects an unauthenticated request (no Bearer, no internal secret) with 401", async () => {
    const { POST } = (await import("./route")) as RouteModule;
    const res = await POST(makeReq({}));
    expect(res.status).toBe(401);
    const j = (await res.json()) as { error?: string };
    expect(j.error).toMatch(/unauthorized/i);
  });

  it("rejects a request carrying a wrong internal secret with 401", async () => {
    process.env.INTERNAL_CRON_SECRET = "the-real-secret";
    const { POST } = (await import("./route")) as RouteModule;
    const res = await POST(makeReq({ "x-internal-secret": "not-the-secret" }));
    expect(res.status).toBe(401);
  });
});
