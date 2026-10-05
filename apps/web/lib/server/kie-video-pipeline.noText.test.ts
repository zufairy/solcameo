import { describe, it, expect } from "vitest";
import { __test } from "./kie-video-pipeline";
import type { GenerateVideoArgs } from "./kie-video-pipeline";

// Staff bug: negative on-screen-text instructions ("no subtitles", "[no
// captions]", "tanpa sarikata") were rendered as literal captions, and engines
// still hallucinated their own subtitles. Detection must catch the operator's
// intent across the surfaces it can arrive on; instruction-echo overlays must
// never be treated as burnable content.

const args = (over: Partial<GenerateVideoArgs>): GenerateVideoArgs => ({
  agentName: "Ava", agentNiche: "beauty", avatarUrl: "https://x/a.png",
  topic: "a day in my life", hook: "h", scriptText: "s", ...over,
});

describe("detectNoOnScreenTextDirective", () => {
  it("catches plain and bracketed negatives in the topic/prompt", () => {
    expect(__test.detectNoOnScreenTextDirective(args({ topic: "make a vlog, no subtitles please" }))).toBe(true);
    expect(__test.detectNoOnScreenTextDirective(args({ topic: "review video [do not add captions]" }))).toBe(true);
    expect(__test.detectNoOnScreenTextDirective(args({ topic: "clean edit without any on-screen text" }))).toBe(true);
  });

  it("catches Malay phrasing and standing orders / brief surfaces", () => {
    expect(__test.detectNoOnScreenTextDirective(args({ topic: "vlog pagi", standingOrders: "jangan letak sarikata" }))).toBe(true);
    expect(__test.detectNoOnScreenTextDirective(args({ topic: "vlog", creativeBrief: { format: "ugc", angle: "tanpa subtitle", topic: "" } }))).toBe(true);
  });

  it("does not fire on ordinary prompts (even ones mentioning text positively)", () => {
    expect(__test.detectNoOnScreenTextDirective(args({ topic: "unboxing my new phone" }))).toBe(false);
    expect(__test.detectNoOnScreenTextDirective(args({ topic: "add a big text hook that says WAIT" }))).toBe(false);
  });
});

describe("isInstructionLikeOverlay", () => {
  it("flags bracketed and directive-shaped overlay text", () => {
    expect(__test.isInstructionLikeOverlay("[no subtitles]")).toBe(true);
    expect(__test.isInstructionLikeOverlay("no captions on this part")).toBe(true);
    expect(__test.isInstructionLikeOverlay("jangan letak teks")).toBe(true);
  });

  it("passes real hooks through", () => {
    expect(__test.isInstructionLikeOverlay("WAIT FOR THE ENDING")).toBe(false);
    expect(__test.isInstructionLikeOverlay("50% OFF TODAY")).toBe(false);
  });
});
