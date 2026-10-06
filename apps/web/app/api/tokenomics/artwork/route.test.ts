// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";

const m = vi.hoisted(() => ({ auth: vi.fn(), owner: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/server/solstarRoute", () => ({ requireProvenWallet: m.auth }));
vi.mock("@/lib/server/platformLaunchOwner", () => ({ platformLaunchOwner: m.owner }));
vi.mock("@/lib/server/imageStorage", () => ({ putImage: m.put, r2ImageConfigured: () => true }));
import { POST } from "./route";

async function upload(width: number, height = width) {
  const png = await sharp({ create: { width, height, channels: 3, background: "#d7ff00" } }).png().toBuffer();
  const form = new FormData();
  form.append("file", new File([new Uint8Array(png)], "art.png", { type: "image/png" }));
  return POST(new NextRequest("http://localhost/api/tokenomics/artwork", { method: "POST", body: form }));
}
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ wallet: "PLATFORM" });
  m.owner.mockResolvedValue("PLATFORM");
  m.put.mockResolvedValue({ url: "https://cdn.example.com/platform-token/a.png", key: "k" });
});
describe("platform artwork upload", () => {
  it("stores a square 1024px PNG and returns its URL for the platform wallet", async () => {
    const res = await upload(600, 400);
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe("https://cdn.example.com/platform-token/a.png");
    const [bytes, type, opts] = m.put.mock.calls[0];
    expect(type).toBe("image/png");
    expect(opts).toEqual({ keyPrefix: "platform-token" });
    const meta = await sharp(bytes).metadata();
    expect([meta.width, meta.height]).toEqual([1024, 1024]);
  });
  it("refuses any wallet except the platform owner", async () => {
    m.auth.mockResolvedValue({ wallet: "SOMEONE_ELSE" });
    expect((await upload(512)).status).toBe(403);
    expect(m.put).not.toHaveBeenCalled();
  });
  it("rejects images that are too small", async () => {
    expect((await upload(100)).status).toBe(400);
  });
});
