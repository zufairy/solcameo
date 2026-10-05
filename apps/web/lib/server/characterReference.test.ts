// @vitest-environment node
import { expect, it, vi } from "vitest";

const put = vi.hoisted(() => vi.fn(async (_b: Buffer, _t: string, o: { key: string }) => ({ url: `https://r2.test/${o.key}`, key: o.key })));
vi.mock("./imageStorage", () => ({
  r2ImageConfigured: () => true,
  imageExists: async () => false,
  imagePublicUrl: (k: string) => `https://r2.test/${k}`,
  putImage: put,
}));
import { buildReferenceSheet } from "./characterReference";

it("composes the picked option previews into one reference sheet", async () => {
  const sharp = (await import("sharp")).default;
  const r = await buildReferenceSheet({ hair: ["hair_long"], ethnicity_origin_base: ["european"], body_type: ["body_slim"], aesthetic: ["goth"] });
  expect(r?.tiles).toBe(4);
  expect(r?.url).toMatch(/^https:\/\/r2\.test\/character-refs\/sheet\/[a-f0-9]{20}\.jpg$/);
  const meta = await sharp(put.mock.calls[0][0]).metadata();
  expect([meta.width, meta.height, meta.format]).toEqual([1024, 1024, "jpeg"]);

  put.mockClear();
  await buildReferenceSheet({ hair: ["hair_long"], aesthetic: ["goth"] });
  const two = await sharp(put.mock.calls[0][0]).metadata();
  expect([two.width, two.height]).toEqual([1024, 512]);
});

it("returns nothing when no selected option has a preview", async () => {
  expect(await buildReferenceSheet({ age: ["adult"] })).toBeUndefined();
});
