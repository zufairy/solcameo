import { describe, it, expect } from "vitest";
import { parseLaunchInput, fallbackIdentity, sanitizeHandle } from "./launchInput";

describe("parseLaunchInput", () => {
  it("requires a website and normalises a bare domain to https", () => {
    expect(parseLaunchInput({})).toEqual({ ok: false, error: "Paste your website URL first." });
    expect(parseLaunchInput({ websiteUrl: "acme.com" })).toEqual({ ok: true, websiteUrl: "https://acme.com/" });
    expect(parseLaunchInput({ websiteUrl: " https://acme.com/pricing " })).toEqual({ ok: true, websiteUrl: "https://acme.com/pricing" });
  });
  it("rejects non-http schemes and localhost", () => {
    expect(parseLaunchInput({ websiteUrl: "ftp://acme.com" }).ok).toBe(false);
    expect(parseLaunchInput({ websiteUrl: "http://localhost:3000" }).ok).toBe(false);
  });
  it("accepts an optional long-form link only from a video host", () => {
    const ok = parseLaunchInput({ websiteUrl: "acme.com", sourceUrl: "https://www.youtube.com/watch?v=abc12345678" });
    expect(ok).toEqual({ ok: true, websiteUrl: "https://acme.com/", sourceUrl: "https://www.youtube.com/watch?v=abc12345678" });
    expect(parseLaunchInput({ websiteUrl: "acme.com", sourceUrl: "https://acme.com/about" }).ok).toBe(false);
    expect(parseLaunchInput({ websiteUrl: "acme.com", sourceUrl: "" })).toEqual({ ok: true, websiteUrl: "https://acme.com/" });
  });
});

describe("fallbackIdentity", () => {
  it("names the agent after the domain stem", () => {
    expect(fallbackIdentity("https://www.habitloop.app/")).toEqual({ agentName: "Habitloop", handle: "habitloop_vello" });
    expect(fallbackIdentity("not a url")).toEqual({ agentName: "New Agent", handle: "new_agent_vello" });
  });
});

describe("sanitizeHandle", () => {
  it("slugs to [a-z0-9_], 3-24 chars, falls back when too short", () => {
    expect(sanitizeHandle("@Habit Loop!", "x_vello")).toBe("habit_loop");
    expect(sanitizeHandle("ab", "fallback_vello")).toBe("fallback_vello");
    expect(sanitizeHandle("a".repeat(40), "f")).toBe("a".repeat(24));
  });
});
