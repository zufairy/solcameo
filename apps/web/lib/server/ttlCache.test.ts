import { describe, expect, it, vi } from "vitest";
import { TtlCache, mapLimit } from "./ttlCache";

describe("TtlCache", () => {
  it("shares one load between concurrent callers and caches the result", async () => {
    const c = new TtlCache<number>(1000);
    const load = vi.fn(async () => 7);
    expect(await Promise.all([c.get("a", load), c.get("a", load), c.get("a", load)])).toEqual([7, 7, 7]);
    await c.get("a", load);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("serves the last good value when a refresh fails", async () => {
    const c = new TtlCache<number>(0);
    await c.get("a", async () => 1);
    expect(await c.get("a", async () => { throw new Error("rpc down"); })).toBe(1);
  });
  it("throws when there is nothing to fall back to", async () => {
    await expect(new TtlCache<number>(0).get("a", async () => { throw new Error("x"); })).rejects.toThrow("x");
  });
});

describe("mapLimit", () => {
  it("keeps order and respects the limit", async () => {
    let live = 0, peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return n * 2; });
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
