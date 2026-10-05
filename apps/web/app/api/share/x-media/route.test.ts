// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.INTERNAL_CRON_SECRET = "test-secret";
  return {
    requireAuth: vi.fn(), checkOwnership: vi.fn(), query: vi.fn(),
    loadShareAgent: vi.fn(), renderShareGif: vi.fn(), putImage: vi.fn(),
  };
});
vi.mock("convex/browser", () => ({ ConvexHttpClient: vi.fn().mockImplementation(() => ({ query: mocks.query })) }));
vi.mock("@/lib/server/requireAuth", () => ({ requireAuth: mocks.requireAuth, checkOwnership: mocks.checkOwnership }));
vi.mock("@/lib/server/xShareCardRender", () => ({ loadShareAgent: mocks.loadShareAgent, renderShareGif: mocks.renderShareGif }));
vi.mock("@/lib/server/imageStorage", () => ({ r2ImageConfigured: () => true, putImage: mocks.putImage }));

import { POST } from "./route";

const mint = "11111111111111111111111111111111";
const request = () => ({ json: async () => ({ mint, nonce: "design-1" }) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue({ user: { id: "owner" } });
  mocks.checkOwnership.mockReturnValue(null);
  mocks.query.mockResolvedValue({ creatorWallet: "wallet" });
  mocks.loadShareAgent.mockResolvedValue({ mint, stats: { name: "Rainier Clips" } });
  mocks.renderShareGif.mockResolvedValue(Buffer.from("GIF89a"));
  mocks.putImage.mockResolvedValue({ url: "https://r2.example/agent-share/x/image.gif" });
});

describe("POST /api/share/x-media", () => {
  it("hosts an owner-authorized image on a public URL for agent X publishing", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, url: "https://r2.example/agent-share/x/image.gif" });
    expect(mocks.renderShareGif).toHaveBeenCalledWith(expect.objectContaining({ mint }), "design-1");
    expect(mocks.putImage).toHaveBeenCalledWith(expect.any(Buffer), "image/gif", { keyPrefix: "agent-share/x" });
  });

  it("does not host images for agents the caller does not own", async () => {
    mocks.checkOwnership.mockReturnValue(new Response("Forbidden", { status: 403 }));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.putImage).not.toHaveBeenCalled();
  });
});
