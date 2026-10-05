import { describe, expect, it } from "vitest";
import { renderHookAss } from "./hookRenderer";
import { resolveHookRender } from "@/lib/builder/hookDesigns";

const dims = { width: 1080, height: 1920 };
const ass = (id: string, text = "This changes everything", dur = 5) =>
  renderHookAss(text, { render: resolveHookRender(id, null), durationSec: dur, ...dims });

describe("renderHookAss", () => {
  it("uses the template's libass family name", () => {
    expect(ass("bold_impact")).toContain("Barlow Condensed");
    expect(ass("clean_slide")).toContain("Barlow Condensed");
    expect(ass("yellow_pop")).toContain("Barlow Condensed");
    expect(ass("black_box")).toContain("Manrope Medium");
    expect(ass("gold_luxe")).toContain("Fraunces 144pt SemiBold");
  });

  it("renders at the font's real weight (Bold=0), not synthetic bold", () => {
    // The bundled files ARE the intended weight (Medium/SemiBold); the Style line's
    // Bold flag must be 0 so libass doesn't fake-embolden them into a heavy look.
    const styleLine = ass("clean_slide").split("\n").find((l) => l.startsWith("Style: Hook,"))!;
    // Fields after BackColour: Bold,Italic,Underline,StrikeOut — Bold must be 0.
    expect(styleLine).toMatch(/,&H[0-9A-F]{8},0,0,0,0,100,100,/);
  });

  it("emits the correct alignment per position in the Style line", () => {
    const styleLine = (id: string) => ass(id).split("\n").find((l) => l.startsWith("Style: Hook,"))!;
    // Alignment is the field right before MarginL,MarginR,MarginV,Encoding.
    expect(styleLine("bold_impact")).toMatch(/,8,\d+,\d+,\d+,1$/); // top
    expect(styleLine("yellow_pop")).toMatch(/,5,\d+,\d+,\d+,1$/);  // center
    expect(styleLine("black_box")).toMatch(/,5,\d+,\d+,\d+,1$/);   // center
  });

  it("insets margins for safe padding (never 0,0,0)", () => {
    const styleLine = ass("bold_impact").split("\n").find((l) => l.startsWith("Style: Hook,"))!;
    expect(styleLine).not.toMatch(/,0,0,0,1$/);
    // round(1080*0.06)=65, round(1920*0.08)=154
    expect(styleLine).toMatch(/,65,65,154,1$/);
  });

  it("POV headline has a gentle entrance", () => {
    const s = ass("bold_impact");
    expect(s).toContain("\\fad(");
  });

  it("quote stack has a gentle entrance", () => {
    const s = ass("yellow_pop");
    expect(s).toContain("\\fad(");
  });

  it("fade template carries \\fad and no scale tween", () => {
    const s = ass("black_box");
    expect(s).toContain("\\fad(");
    expect(s).not.toContain("\\t(");
  });

  it("front page stays at the top band", () => {
    expect(ass("clean_slide")).toMatch(/,8,65,65,154,1/);
  });

  it("the brief holds one legible headline", () => {
    const s = ass("gold_luxe", "one two three four");
    const dialogues = s.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues.length).toBe(1);
    expect(dialogues[0].endsWith("one two three four")).toBe(true);
  });

  it("the brief remains for the requested duration", () => {
    // Regression: previously every event ran to `end`, so all progressive lines
    // were simultaneously on-screen (stacked). Each intermediate step must end at
    // the next step's start; only the final full line holds to the end.
    const s = ass("gold_luxe", "one two three four", 4); // per = 1.00s
    const rows = s.split("\n").filter((l) => l.startsWith("Dialogue:"));
    // Start,End are fields 2 and 3 (comma-separated) of the Dialogue line.
    const times = rows.map((r) => { const p = r.split(","); return { start: p[1], end: p[2] }; });
    expect(times).toEqual([{ start: "0:00:00.00", end: "0:00:04.00" }]);
  });

  it("uppercases when the template is allCaps", () => {
    expect(ass("yellow_pop", "loud")).toContain("LOUD");
  });

  it("times events within the duration window", () => {
    const s = ass("bold_impact", "hi", 4);
    expect(s).toContain("0:00:00.00,0:00:04.00");
  });
});
