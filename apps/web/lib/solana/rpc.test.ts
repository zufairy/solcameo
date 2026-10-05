import { describe, expect, it, vi } from "vitest";
import { Connection } from "@solana/web3.js";
import { rpcTry } from "./rpc";

describe("rpcTry", () => {
  it("tries the next candidate when the current one throws", async () => {
    const fn = vi.fn(async (conn: Connection) => {
      if (conn.rpcEndpoint.includes("dead")) throw new Error("403 subscription suspended");
      return "ok";
    });
    const result = await rpcTry(["https://dead.invalid/", "https://alive.invalid/"], fn);
    expect(result).toBe("ok");
    // Once for the dead candidate (threw) + once for the alive one.
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("returns on the first successful candidate", async () => {
    const fn = vi.fn(async () => 42);
    const result = await rpcTry(["https://alive.invalid/", "https://never.invalid/"], fn);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws the last error when all candidates fail", async () => {
    const fn = vi.fn(async (conn: Connection) => {
      throw new Error(`failed on ${conn.rpcEndpoint}`);
    });
    await expect(rpcTry(["https://a.invalid/", "https://b.invalid/"], fn)).rejects.toThrow(
      "failed on https://b.invalid/",
    );
  });
});
