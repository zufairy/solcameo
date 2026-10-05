// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * The Paste-URL resolver route. Two guarantees, both regression-tested here:
 *
 *  1. It expands a pasted Drive FOLDER ({ videos, isFolder:true }) and passes any
 *     normal link through as a single source ({ isFolder:false }) — and a BLANK /
 *     bad URL returns { videos: [], isFolder: false } with a 200 (a user typo must
 *     never 500, and the resolver isn't even called).
 *  2. Auth matches the sibling campaign-sources route: a logged-in user (a valid
 *     Privy Bearer) or the internal secret → 200 with NO SIWS signature; an
 *     unauthenticated caller → 401 and the resolver is never reached.
 *
 * Only the two leaf deps are mocked (the resolver + auth); the route glue runs.
 */
const h = vi.hoisted(() => ({ resolveMock: vi.fn(), authMock: vi.fn() }));

vi.mock("@/lib/server/campaignSources", () => ({ resolveSourceUrl: h.resolveMock }));
vi.mock("@/lib/server/requireAuth", () => ({ requireInternalOrUserAuth: h.authMock }));

import { GET, POST } from "./route";

function makeReq(url?: string): NextRequest {
  const qs = url ? `?url=${encodeURIComponent(url)}` : "";
  return { nextUrl: new URL(`https://vello.test/api/clip/resolve-source-url${qs}`) } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default caller: a logged-in user WITHOUT a SIWS session (no provenWallet).
  h.authMock.mockResolvedValue({ user: { id: "u1" }, token: "tok", internal: false });
});

describe("GET /api/clip/resolve-source-url", () => {
  it("expands a pasted Drive FOLDER → { videos, isFolder:true }", async () => {
    const videos = [{ url: "https://drive.google.com/file/d/f1/view", name: "a.mp4" }];
    h.resolveMock.mockResolvedValue({ videos, isFolder: true });
    const res = await GET(makeReq("https://drive.google.com/drive/folders/FID"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ videos, isFolder: true });
    expect(h.resolveMock).toHaveBeenCalledWith("https://drive.google.com/drive/folders/FID");
  });

  it("passes a normal link through as a single source ({ isFolder:false })", async () => {
    h.resolveMock.mockResolvedValue({ videos: [{ url: "https://youtu.be/x", name: "youtu.be/x" }], isFolder: false });
    const res = await GET(makeReq("https://youtu.be/x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ isFolder: false });
  });

  it("a blank url → { videos: [], isFolder: false } WITHOUT calling the resolver (no 500 on a typo)", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ videos: [], isFolder: false });
    expect(h.resolveMock).not.toHaveBeenCalled();
  });

  it("200s an internal-secret caller (cron/backfill)", async () => {
    h.authMock.mockResolvedValue({ internal: true });
    h.resolveMock.mockResolvedValue({ videos: [], isFolder: false });
    const res = await GET(makeReq("https://brand.example"));
    expect(res.status).toBe(200);
  });

  it("still 401s an unauthenticated caller (the Bearer gate stays; resolver untouched)", async () => {
    h.authMock.mockResolvedValue({ error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const res = await GET(makeReq("https://drive.google.com/drive/folders/FID"));
    expect(res.status).toBe(401);
    expect(h.resolveMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/clip/resolve-source-url", () => {
  it("reads the url from the JSON body", async () => {
    h.resolveMock.mockResolvedValue({ videos: [], isFolder: true });
    const req = {
      nextUrl: new URL("https://vello.test/api/clip/resolve-source-url"),
      json: async () => ({ url: "https://drive.google.com/drive/folders/FID" }),
    } as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(h.resolveMock).toHaveBeenCalledWith("https://drive.google.com/drive/folders/FID");
  });
});
