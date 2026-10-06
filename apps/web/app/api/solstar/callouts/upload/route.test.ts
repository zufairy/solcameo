import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), put: vi.fn(), configured: vi.fn() }));
vi.mock("@/lib/server/solstarRoute", () => ({ requireProvenWallet: mocks.auth }));
vi.mock("@/lib/server/imageStorage", () => ({ putImage: mocks.put, r2ImageConfigured: mocks.configured }));
import { POST } from "./route";
function request(bytes: Uint8Array, type = "image/png") {
  const body = new FormData(); body.append("file", new File([bytes as BlobPart], "photo.png", { type }));
  return new NextRequest("http://localhost/api/solstar/callouts/upload", { method: "POST", body });
}
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ wallet: "signed-wallet" }); mocks.configured.mockReturnValue(true); mocks.put.mockResolvedValue({ url: "https://cdn.example.com/callouts/image.png" }); });
describe("callout upload", () => {
  it("requires a signed wallet before storing anything", async () => {
    mocks.auth.mockResolvedValue({ res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) });
    expect((await POST(request(new Uint8Array([1])))).status).toBe(401);
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("detects actual image format and stores in the callout namespace", async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toBuffer();
    const res = await POST(request(bytes, "image/gif"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ type: "image", alt: "photo.png" });
    expect(mocks.put).toHaveBeenCalledWith(expect.any(Buffer), "image/png", { keyPrefix: "callouts" });
  });
  it("preserves GIF bytes rather than flattening them into a still image", async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).gif().toBuffer();
    const res = await POST(request(bytes, "image/gif"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ type: "gif" });
    expect(mocks.put).toHaveBeenCalledWith(bytes, "image/gif", { keyPrefix: "callouts" });
  });
  it("rejects fake image content", async () => {
    expect((await POST(request(new TextEncoder().encode("<svg onload='alert(1)'/>")))).status).toBe(400);
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("rejects oversized requests before reading the body", async () => {
    const req = request(new Uint8Array([1])); req.headers.set("content-length", "10000000");
    expect((await POST(req)).status).toBe(413);
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
