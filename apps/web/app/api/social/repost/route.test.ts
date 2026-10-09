import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const h = vi.hoisted(() => ({ auth: vi.fn(), owner: vi.fn(), query: vi.fn(), mutation: vi.fn(), readX: vi.fn() }));
vi.mock("@/lib/server/requireAuth", () => ({ requireInternalOrUserAuth: h.auth, requireOwnerWithSiws: h.owner }));
vi.mock("@/lib/server/xApi", () => ({ readX: h.readX }));
vi.mock("@/lib/server/uploadPost", () => ({ resolveUsername: (mint: string) => mint }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = h.query; mutation = h.mutation; } }));
import { POST } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ internal: false, wallet: "owner" });
  h.owner.mockReturnValue(null);
  h.query.mockResolvedValue({ creatorWallet: "owner" });
  h.readX.mockResolvedValue({ id: "account" });
  h.mutation.mockResolvedValue({ id: "row", status: "scheduled" });
});
const request = () => POST(new NextRequest("https://solcameo.com/api/social/repost", { method: "POST", body: JSON.stringify({ mintAddress: "mint", videoUrl: "https://media.test/v.mp4", title: "Video" }) }));
describe("owner-authorized video repost", () => {
  it("queues the existing video without generating another", async () => {
    const response = await request();
    expect(await response.json()).toMatchObject({ ok: true, status: "scheduled" });
    expect(h.mutation).toHaveBeenCalledOnce();
    expect(h.mutation.mock.calls[0][1]).toMatchObject({ mintAddress: "mint", videoUrl: "https://media.test/v.mp4" });
  });
  it("denies another owner before reading credentials or changing the queue", async () => {
    h.owner.mockReturnValue(NextResponse.json({ error: "Not owner" }, { status: 403 }));
    expect((await request()).status).toBe(403);
    expect(h.readX).not.toHaveBeenCalled();
    expect(h.mutation).not.toHaveBeenCalled();
  });
  it("requires an X API connection belonging to this agent", async () => {
    h.readX.mockResolvedValue(null);
    expect((await request()).status).toBe(409);
    expect(h.readX).toHaveBeenCalledWith("mint");
    expect(h.mutation).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    h.auth.mockResolvedValue({ error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    expect((await request()).status).toBe(401);
    expect(h.query).not.toHaveBeenCalled();
  });
});
