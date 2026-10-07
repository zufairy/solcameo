import { describe, expect, it, vi } from "vitest";
import { failoverFetch } from "./failoverConnection";

const ok = (body = "{}") => new Response(body, { status: 200 });
const status = (code: number) => new Response("", { status: code });

describe("failoverFetch", () => {
  it("uses the first endpoint when it answers", async () => {
    const base = vi.fn(async (_url: string) => ok());
    await failoverFetch(["https://a", "https://b"], 1000, base as never)("ignored", { method: "POST" });
    expect(base).toHaveBeenCalledTimes(1);
    expect(base.mock.calls[0][0]).toBe("https://a");
  });
  it("moves to the next endpoint on 429, 403 and 5xx, and returns the first good answer", async () => {
    for (const code of [429, 403, 500, 503]) {
      const base = vi.fn(async (url: string) => (url === "https://a" ? status(code) : ok("good")));
      const res = await failoverFetch(["https://a", "https://b"], 1000, base as never)("x", {});
      expect(await res.text()).toBe("good");
    }
  });
  it("moves on after a network error or a timeout", async () => {
    const base = vi.fn(async (url: string) => { if (url === "https://a") throw new Error("socket hang up"); return ok("b"); });
    expect(await (await failoverFetch(["https://a", "https://b"], 1000, base as never)("x", {})).text()).toBe("b");
  });
  it("does not retry a normal 4xx answer (a real JSON-RPC problem belongs to the caller)", async () => {
    const base = vi.fn(async () => status(400));
    const res = await failoverFetch(["https://a", "https://b"], 1000, base as never)("x", {});
    expect(res.status).toBe(400);
    expect(base).toHaveBeenCalledTimes(1);
  });
  it("returns the last HTTP error when every endpoint is down, and throws when none answered at all", async () => {
    expect((await failoverFetch(["https://a", "https://b"], 1000, (async () => status(503)) as never)("x", {})).status).toBe(503);
    await expect(failoverFetch(["https://a"], 1000, (async () => { throw new Error("down"); }) as never)("x", {})).rejects.toThrow("down");
  });
  it("gives every endpoint its own deadline", async () => {
    const base = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://slow") await new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
      return ok("fast");
    });
    expect(await (await failoverFetch(["https://slow", "https://fast"], 30, base as never)("x", {})).text()).toBe("fast");
  });
});
