import { describe, it, expect } from "vitest";
import { wrapDrawtext } from "./clipFilterGraph";

const W = 1080;
// chars/line at fontSize fs ≈ floor((1080-80)/(0.68*fs))
const maxChars = (fs: number) => Math.floor((W - 2 * 40) / (0.68 * fs));
const longestLine = (t: string) => Math.max(...t.split("\n").map((l) => l.length));

describe("wrapDrawtext", () => {
  it("leaves a short line untouched (one line, same font)", () => {
    const r = wrapDrawtext("POV: you ship", 48, W);
    expect(r.text).toBe("POV: you ship");
    expect(r.text).not.toContain("\n");
    expect(r.fontSize).toBe(48);
  });

  it("wraps the overflowing hook so every line fits the frame", () => {
    // The exact bug: ~7-word hook that spilled off both edges at fontSize 56.
    const r = wrapDrawtext("Every person has exactly two things in common", 56, W);
    expect(r.text).toContain("\n");
    for (const line of r.text.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(maxChars(r.fontSize));
    }
  });

  it("never exceeds maxLines (default 2) — shrinks the font instead", () => {
    const long = "this is a deliberately very long hook line that will not fit two lines at full size";
    const r = wrapDrawtext(long, 60, W, 2);
    expect(r.text.split("\n").length).toBeLessThanOrEqual(2);
    // font shrank toward the 70% floor to make it fit
    expect(r.fontSize).toBeLessThanOrEqual(60);
    expect(r.fontSize).toBeGreaterThanOrEqual(Math.round(60 * 0.7));
  });

  it("hard-splits a single word longer than a line", () => {
    const r = wrapDrawtext("supercalifragilisticexpialidocioussupercalifragilistic", 80, W);
    expect(longestLine(r.text)).toBeLessThanOrEqual(maxChars(r.fontSize));
  });

  it("respects a higher maxLines for title cards", () => {
    const r = wrapDrawtext("one two three four five six seven eight nine ten eleven twelve", 64, W, 3);
    expect(r.text.split("\n").length).toBeLessThanOrEqual(3);
  });
});
