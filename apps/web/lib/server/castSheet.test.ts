import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const h = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("./imageStorage", () => ({ putImage: h.put }));
import { MAX_CAST, buildCastSheet, packCast } from "./castSheet";

const png = (color: string) => sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer();
const cast = (n: number) => Array.from({ length: n }, (_, i) => ({ token: `Agent${i + 1}`, imageUrl: `https://img.test/${i + 1}.png` }));

beforeEach(async () => {
  h.put.mockReset();
  h.put.mockImplementation(async (_b: Buffer, _t: string, o: { key: string }) => ({ url: `https://cdn.test/${o.key}`, key: o.key }));
  const image = await png("#336699");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(image), { status: 200 })));
});

describe("cast packing", () => {
  it("allows five tagged characters", () => { expect(MAX_CAST).toBe(5); });

  it("sends each portrait as its own image while they fit the engine's slots", async () => {
    const packed = await packCast(cast(2), 2);
    expect(packed.map((p) => p.imageUrl)).toEqual(["https://img.test/1.png", "https://img.test/2.png"]);
    expect(packed[0].label).toContain("@Agent1");
    expect(h.put).not.toHaveBeenCalled();
  });

  it("combines all five into ONE cast sheet when the engine has fewer slots", async () => {
    const packed = await packCast(cast(5), 2);
    expect(packed).toHaveLength(1);
    expect(packed[0].imageUrl).toMatch(/^https:\/\/cdn\.test\/cast-sheets\/[0-9a-f]{40}\.png$/);
    for (let i = 1; i <= 5; i++) expect(packed[0].label).toContain(`@Agent${i}`);
    const sheet = h.put.mock.calls[0][0] as Buffer;
    const meta = await sharp(sheet).metadata();
    expect(meta.width).toBe(512 * 5); // one tile per character, side by side
    expect(meta.height).toBe(640);
  });

  it("builds the same sheet key for the same cast, so it is made once", async () => {
    await buildCastSheet(cast(3));
    await buildCastSheet(cast(3));
    expect(h.put.mock.calls[0][2].key).toBe(h.put.mock.calls[1][2].key);
  });

  it("falls back to the first portraits when the sheet cannot be built", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const packed = await packCast(cast(5), 2);
    expect(packed.map((p) => p.token)).toEqual(["Agent1", "Agent2"]);
  });
});
