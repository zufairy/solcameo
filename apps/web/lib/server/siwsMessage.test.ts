// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildSiwsMessage, SIWS_MESSAGE_INTRO } from "./siwsMessage";

describe("siwsMessage", () => {
  const fields = {
    wallet: "5xJ...WALLET",
    nonce: "nonce.token.value",
    issuedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_300_000,
  };

  it("is deterministic for identical fields (server can reconstruct byte-for-byte)", () => {
    expect(buildSiwsMessage(fields)).toBe(buildSiwsMessage(fields));
  });

  it("embeds the branded intro and all load-bearing fields", () => {
    const msg = buildSiwsMessage(fields);
    expect(msg.startsWith(SIWS_MESSAGE_INTRO)).toBe(true);
    expect(msg).toContain("Vello");
    expect(msg).toContain(`Wallet: ${fields.wallet}`);
    expect(msg).toContain(`Nonce: ${fields.nonce}`);
    expect(msg).toContain(new Date(fields.issuedAt).toISOString());
    expect(msg).toContain(new Date(fields.expiresAt).toISOString());
  });

  it("changes when any load-bearing field changes", () => {
    const base = buildSiwsMessage(fields);
    expect(buildSiwsMessage({ ...fields, wallet: "other" })).not.toBe(base);
    expect(buildSiwsMessage({ ...fields, nonce: "other" })).not.toBe(base);
    expect(buildSiwsMessage({ ...fields, expiresAt: fields.expiresAt + 1 })).not.toBe(base);
  });
});
