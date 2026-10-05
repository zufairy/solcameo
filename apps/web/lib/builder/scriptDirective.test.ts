/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { parseScriptDirective, SCRIPT_LENGTH_STEPS } from "./scriptDirective";

describe("SCRIPT_LENGTH_STEPS", () => {
  it("is the 8..60 ladder", () => {
    expect([...SCRIPT_LENGTH_STEPS]).toEqual([8, 16, 24, 32, 48, 60]);
  });
});

describe("parseScriptDirective — absolute", () => {
  it("'make it a 1 minute version' -> 60", () => {
    const d = parseScriptDirective("make it a 1 minute version", 24);
    expect(d.isLengthEdit).toBe(true);
    expect(d.seconds).toBe(60);
  });
  it("'30 seconds' -> 30", () => {
    expect(parseScriptDirective("keep it 30 seconds", 24).seconds).toBe(30);
  });
  it("'60s' -> 60", () => {
    expect(parseScriptDirective("60s please", 24).seconds).toBe(60);
  });
  it("'half a minute' -> 30", () => {
    expect(parseScriptDirective("half a minute", 24).seconds).toBe(30);
  });
  it("clamps '5 minutes' -> 60 and '2s' -> 5", () => {
    expect(parseScriptDirective("5 minutes", 24).seconds).toBe(60);
    expect(parseScriptDirective("2s", 24).seconds).toBe(5);
  });
});

describe("parseScriptDirective — relative", () => {
  it("'make it longer' steps up 24 -> 32", () => {
    expect(parseScriptDirective("make it longer", 24).seconds).toBe(32);
  });
  it("'way longer' steps up two 16 -> 32", () => {
    expect(parseScriptDirective("way longer", 16).seconds).toBe(32);
  });
  it("'shorter' steps down 24 -> 16", () => {
    expect(parseScriptDirective("make it shorter", 24).seconds).toBe(16);
  });
  it("longer at the top (60) stays 60", () => {
    expect(parseScriptDirective("longer", 60).seconds).toBe(60);
  });
});

describe("parseScriptDirective — refinement + non-length", () => {
  it("extracts refinement around the length phrase", () => {
    const d = parseScriptDirective("make it funnier and 1 minute long", 24);
    expect(d.seconds).toBe(60);
    expect(d.refinement.toLowerCase()).toContain("funnier");
  });
  it("non-length message -> isLengthEdit false", () => {
    const d = parseScriptDirective("make a video about coffee", 24);
    expect(d.isLengthEdit).toBe(false);
  });
});
