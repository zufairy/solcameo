import { describe, it, expect } from "vitest";
import { withoutPostLinks, withTicker, tokenLaunchCaption, videoLaunchCaption, coinsDigestCaption } from "./marketingCaption";

describe("link-free alert captions", () => {
  it("removes full URLs, bare domains and markdown links without removing ticker or context", () => {
    const caption = withoutPostLinks("Watch $ALG explain AI. https://solcameo.com/market/alg\nwww.example.com solcameo.com [the video](https://example.com/video)");
    expect(caption).toContain("$ALG explain AI");
    expect(caption).toContain("the video");
    expect(caption).not.toMatch(/https?:|www\.|solcameo\.com|example\.com/);
  });
  it("keeps the ticker while discarding an old market link", () => {
    const caption = withTicker("A creator explains machine learning https://solcameo.com/market/alg", { ticker: "ALG", url: "https://solcameo.com/market/alg" });
    expect(caption).toContain("$ALG");
    expect(caption).not.toContain("http");
    expect(withTicker("$ALG explains AI. solcameo.com", { ticker: "ALG", url: "https://solcameo.com" })).toBe("$ALG explains AI.");
  });
  it("gives video context, a watch-through hook and a ticker without a link", () => {
    const caption = videoLaunchCaption({ name: "Along Rocket", ticker: "ALG", topic: "How AI changes video editing", url: "https://solcameo.com/market/alg" });
    expect(caption).toContain("$ALG");
    expect(caption).toContain("How AI changes video editing");
    expect(caption).toMatch(/watch/i);
    expect(caption).not.toContain("http");
    expect(caption.length).toBeLessThanOrEqual(275);
  });
  it("keeps coin alerts and digests link-free", () => {
    const coin = tokenLaunchCaption({ name: "Along Rocket", ticker: "ALG", bio: "An AI creator explains technology", url: "https://solcameo.com/market/alg" });
    const digest = coinsDigestCaption({ count: 1, total: 10, tickers: ["ALG"], url: "https://solcameo.com" });
    for (const caption of [coin, digest]) {
      expect(caption).toContain("$ALG");
      expect(caption).not.toMatch(/https?:|solcameo\.com/);
    }
  });
});
