import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "./mapWithConcurrency";

/** Deferred promise helper — resolve it by hand to control completion order. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("mapWithConcurrency", () => {
  it("returns results in input order regardless of completion order", async () => {
    // Complete later items first; the runner must still line results up by index.
    const out = await mapWithConcurrency([10, 20, 30, 40], 2, async (n, i) => {
      await new Promise<void>((r) => setTimeout(r, (4 - i) * 5));
      return n * 2;
    });
    expect(out).toEqual([20, 40, 60, 80]);
    // second arg is the original index
    const idx = await mapWithConcurrency(["a", "b", "c"], 2, async (_v, i) => i);
    expect(idx).toEqual([0, 1, 2]);
  });

  it("never exceeds the concurrency limit in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const gates = Array.from({ length: 9 }, () => deferred<void>());
    const run = mapWithConcurrency([0, 1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await gates[n].promise;
      inFlight--;
      return n;
    });
    // Let the first wave (3) start, then release them in turn, wave by wave.
    for (let i = 0; i < gates.length; i++) {
      await Promise.resolve(); // flush microtasks so the wave can start
      gates[i].resolve();
    }
    await run;
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBe(3);
  });

  it("does NOT reject the whole run when fn catches its own error per item", async () => {
    // fn returns a settled sentinel instead of throwing — the runner completes.
    const settled = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      try {
        if (n % 2 === 0) throw new Error(`boom ${n}`);
        return { ok: true as const, value: n };
      } catch {
        return { ok: false as const };
      }
    });
    expect(settled).toEqual([
      { ok: true, value: 1 },
      { ok: false },
      { ok: true, value: 3 },
      { ok: false },
    ]);
  });

  it("rejects the whole run if fn throws uncaught (fail-fast, like Promise.all)", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("uncaught");
        return n;
      }),
    ).rejects.toThrow("uncaught");
  });

  it("handles an empty list and a limit smaller than 1", async () => {
    expect(await mapWithConcurrency([], 4, async (n: number) => n)).toEqual([]);
    // limit floored to 1 (still runs, just fully serial)
    expect(await mapWithConcurrency([1, 2, 3], 0, async (n) => n + 1)).toEqual([2, 3, 4]);
  });
});
