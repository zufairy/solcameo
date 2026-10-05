import { describe, expect, it } from "vitest";
import { looksLikeBotChallenge } from "./articleScreenshot";

describe("looksLikeBotChallenge", () => {
  it("flags real bot-wall/CAPTCHA page titles (the reported bug: this shipped as the headline)", () => {
    expect(looksLikeBotChallenge("Just a moment...")).toBe(true);
    expect(looksLikeBotChallenge("Attention Required! | Cloudflare")).toBe(true);
    expect(looksLikeBotChallenge("Access denied")).toBe(true);
    expect(looksLikeBotChallenge("Please verify you are a human")).toBe(true);
    expect(looksLikeBotChallenge("hCaptcha solve challenge")).toBe(true);
    expect(looksLikeBotChallenge("Checking your browser before accessing example.com")).toBe(true);
    expect(looksLikeBotChallenge("Unusual traffic from your network")).toBe(true);
  });

  it("does not flag real news headlines", () => {
    expect(looksLikeBotChallenge("Supreme Court rules 6-3 in landmark privacy case")).toBe(false);
    expect(looksLikeBotChallenge("Local council approves new transit line downtown")).toBe(false);
    expect(looksLikeBotChallenge("")).toBe(false);
    expect(looksLikeBotChallenge("   ")).toBe(false);
  });
});
