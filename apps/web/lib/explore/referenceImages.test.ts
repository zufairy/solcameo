import { describe, expect, it } from "vitest";
import { MAX_REFERENCE_IMAGES, cleanReferenceUrls, extrasToCast, splitReferences } from "./referenceImages";

describe("cleanReferenceUrls", () => {
  it("keeps https links, in order, without repeats, up to the limit", () => {
    const urls = Array.from({ length: 9 }, (_, i) => `https://x.test/${i}.png`);
    expect(cleanReferenceUrls([...urls, urls[0], "http://nope", 4, null])).toEqual(urls.slice(0, MAX_REFERENCE_IMAGES));
  });
  it("tolerates anything that is not a list", () => expect(cleanReferenceUrls("https://a.test/x.png")).toEqual([]));
});
describe("splitReferences", () => {
  it("first upload leads when there is no cameo", () => expect(splitReferences(["a", "b", "c"], false)).toEqual({ main: "a", extras: ["b", "c"] }));
  it("a cameo portrait leads and every upload is extra", () => expect(splitReferences(["a", "b"], true)).toEqual({ main: null, extras: ["a", "b"] }));
});
describe("extrasToCast", () => {
  it("names extras image2, image3, ...", () => expect(extrasToCast(["u1", "u2"])).toEqual([{ token: "image2", imageUrl: "u1" }, { token: "image3", imageUrl: "u2" }]));
});
