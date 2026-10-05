import { describe, expect, it } from "vitest";
import { chatErrorMessage, toFeedView, type FeedRowInput } from "./feedView";

const base: FeedRowInput = { id: "1", kind: "chat", body: "gm", network: "paper", createdAt: 5 };

describe("toFeedView", () => {
  it("maps chat with initials from the short wallet", () => {
    const v = toFeedView({ ...base, wallet: "AbCd…wxyz" });
    expect(v).toMatchObject({ kind: "chat", author: "AbCd…wxyz", initials: "AB", body: "gm" });
  });
  it("chat without wallet is Anonymous", () => {
    expect(toFeedView(base)).toMatchObject({ kind: "chat", author: "Anonymous", initials: "?" });
  });
  it("maps events", () => {
    expect(toFeedView({ ...base, kind: "event", eventType: "character_created", characterId: "c1" }))
      .toMatchObject({ kind: "character_created", characterId: "c1" });
    expect(toFeedView({ ...base, kind: "event", eventType: "trade", side: "buy" }))
      .toMatchObject({ kind: "trade", side: "buy", simulated: true });
    expect(toFeedView({ ...base, kind: "event", eventType: "trade", side: "sell", network: "devnet" }))
      .toMatchObject({ kind: "trade", side: "sell", simulated: false });
    expect(toFeedView({ ...base, kind: "event", eventType: "follow" })).toMatchObject({ kind: "follow" });
  });
  it("returns null for malformed rows", () => {
    expect(toFeedView({ ...base, kind: "event" })).toBeNull();
    expect(toFeedView({ ...base, kind: "event", eventType: "trade" })).toMatchObject({ kind: "trade", side: null });
    expect(toFeedView({ ...base, body: "" })).toBeNull();
    expect(toFeedView({ ...base, kind: "weird" as never })).toBeNull();
  });
});

describe("chatErrorMessage", () => {
  it("maps codes", () => {
    expect(chatErrorMessage(429, "rate_limited")).toMatch(/too fast/);
    expect(chatErrorMessage(409, "duplicate_message")).toBe("You already sent that.");
    expect(chatErrorMessage(400, "invalid_body")).toMatch(/280/);
    expect(chatErrorMessage(401)).toBe("Sign-in expired. Reconnect your wallet to chat.");
    expect(chatErrorMessage(500, "internal_error")).toBe("Couldn't send. Try again.");
    expect(chatErrorMessage(400, "invalid_wallet")).toBe("Couldn't send. Try again.");
  });
});
