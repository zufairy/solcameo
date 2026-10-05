import { describe, it, expect } from "vitest";
import { classifyMintError } from "./mintErrors";

describe("classifyMintError", () => {
  it("treats a wallet 4001 code as a declined prompt", () => {
    const r = classifyMintError({ code: 4001, message: "User rejected the request." });
    expect(r.kind).toBe("declined");
    // Declined always gets the calm canonical copy, never a scary raw string.
    expect(r.message).toMatch(/cancel/i);
  });

  it("treats 'User rejected' / 'declined' / 'closed' text as declined", () => {
    for (const m of ["User rejected the request", "You declined the signature", "user closed the popup"]) {
      expect(classifyMintError(new Error(m)).kind).toBe("declined");
    }
  });

  it("classifies insufficient-funds errors as funds and keeps the specific message", () => {
    const r = classifyMintError(new Error("insufficient USDC balance"));
    expect(r.kind).toBe("funds");
    expect(r.message).toMatch(/insufficient/i);
  });

  it("classifies blockhash/expiry/RPC errors as network", () => {
    for (const m of ["block height exceeded", "Blockhash not found", "failed to fetch", "RPC timeout"]) {
      expect(classifyMintError(new Error(m)).kind).toBe("network");
    }
  });

  it("falls back to server for an unknown error", () => {
    const r = classifyMintError(new Error("Mint failed"));
    expect(r.kind).toBe("server");
    expect(r.message).toBe("Mint failed");
  });

  it("never throws on odd inputs and always returns a non-empty message", () => {
    for (const input of [undefined, null, "", 42, {}, { message: "" }]) {
      const r = classifyMintError(input);
      expect(["declined", "network", "funds", "server"]).toContain(r.kind);
      expect(r.message.length).toBeGreaterThan(0);
    }
  });
});
