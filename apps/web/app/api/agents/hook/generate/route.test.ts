// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildHookPrompt, tidyHook } from "./hookPrompt";

/**
 * The Editor tab's "What kind of hook?" prompt box must ACTUALLY steer the
 * generated line — language, emoji, casualness, whatever the operator asks
 * for. The old system prompt hardcoded "no emojis" as an absolute rule, which
 * silently ignored a brief that explicitly asked for emoji; buildHookPrompt
 * fixes that by making the operator's brief override every default.
 */
describe("buildHookPrompt", () => {
  it("states the brief OVERRIDES the system defaults whenever they conflict", () => {
    const { system } = buildHookPrompt({ prompt: "make it funny" });
    expect(system).toMatch(/OVERRIDES/i);
    expect(system.toLowerCase()).toContain("brief");
  });

  it("lists emoji/language/casualness as things the brief can turn on, not a hard 'no emoji' rule", () => {
    const { system } = buildHookPrompt({ prompt: "x" });
    // The default line still exists ("no emoji" as a DEFAULT)...
    expect(system.toLowerCase()).toContain("no emoji");
    // ...but is explicitly scoped as overridable, not absolute.
    expect(system).toMatch(/emoji use.*if the brief asks for it, do it/i);
  });

  it("carries the operator's exact brief into the user message, marked authoritative", () => {
    const { user } = buildHookPrompt({ prompt: "malay, casual words, add emoji" });
    expect(user).toContain("malay, casual words, add emoji");
    expect(user).toMatch(/authoritative/i);
  });

  it("includes the clip's own content so the hook matches THIS clip, not a generic one", () => {
    const { user } = buildHookPrompt({ prompt: "curiosity hook", content: "she tried the product and it broke on day one" });
    expect(user).toContain("she tried the product and it broke on day one");
    expect(user).toMatch(/Video content/);
  });

  it("passes the dropdown language as a DEFAULT the brief can still override", () => {
    const { user } = buildHookPrompt({ prompt: "make it spicy", language: "Malay" });
    expect(user).toContain("Default language");
    expect(user).toContain("Malay");
    expect(user).toMatch(/brief above can override/i);
  });

  it("omits optional fields cleanly when absent (no dangling labels)", () => {
    const { user } = buildHookPrompt({ prompt: "just a hook" });
    expect(user).not.toContain("Video content");
    expect(user).not.toContain("Video topic");
    expect(user).not.toContain("Creator niche");
    expect(user).not.toContain("Default language");
  });

  it("truncates an oversized prompt/content instead of blowing the token budget", () => {
    const hugePrompt = "a".repeat(2000);
    const hugeContent = "b".repeat(5000);
    const { user } = buildHookPrompt({ prompt: hugePrompt, content: hugeContent });
    // 500-char prompt cap + 1800-char content cap + labels/newlines — bounded,
    // not unbounded (the pre-truncation input here is 7000 chars).
    expect(user.length).toBeLessThan(2500);
  });
});

describe("tidyHook", () => {
  it("takes the first non-empty line and strips wrapping quotes", () => {
    expect(tidyHook('"This is it"\n')).toBe("This is it");
  });

  it("strips a leading list marker / number", () => {
    expect(tidyHook("1. Wait for it")).toBe("Wait for it");
  });

  it("preserves emoji (the fix — old rule discarded them, this just doesn't touch them)", () => {
    expect(tidyHook("Wait for it 😱🔥")).toBe("Wait for it 😱🔥");
  });

  it("preserves non-Latin script (Malay/Chinese/etc via the brief)", () => {
    expect(tidyHook("Tunggu je korang 😭")).toBe("Tunggu je korang 😭");
  });

  it("truncates an overlong line at a word boundary", () => {
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const out = tidyHook(long);
    expect(out.length).toBeLessThanOrEqual(90);
    expect(long.startsWith(out)).toBe(true);
  });
});
