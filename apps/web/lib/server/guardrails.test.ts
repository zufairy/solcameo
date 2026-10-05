import { describe, it, expect } from "vitest";
import { checkProfanity, scrubProfanity, evaluateQuality, hasGuardrailsInstalled, guardrailsEnabled, GUARDRAILS_SKILL_IDS } from "./guardrails";

describe("checkProfanity", () => {
  it("passes clean text", () => {
    expect(checkProfanity("Check out this Solana trading tip!")).toEqual({ pass: true, hits: [] });
  });

  it("passes empty/undefined text", () => {
    expect(checkProfanity(undefined)).toEqual({ pass: true, hits: [] });
    expect(checkProfanity("")).toEqual({ pass: true, hits: [] });
  });

  it("flags a bad word case-insensitively", () => {
    const r = checkProfanity("This is such BULLSHIT wait no this is Shit honestly");
    expect(r.pass).toBe(false);
    expect(r.hits).toEqual(["shit"]);
  });

  it("does not false-positive on substrings (word-boundary matched)", () => {
    // "classic" contains no bad word as a substring anyway, but "assassin" contains
    // "ass"-adjacent letters — make sure a benign word with embedded letters isn't hit.
    expect(checkProfanity("Assassin's Creed gameplay highlights").pass).toBe(true);
  });

  it("dedupes repeated hits", () => {
    const r = checkProfanity("shit shit shit");
    expect(r.hits).toEqual(["shit"]);
  });
});

describe("scrubProfanity (guardrails word-scrub — keeps the requested clip count)", () => {
  it("returns empty for empty/undefined", () => {
    expect(scrubProfanity(undefined)).toBe("");
    expect(scrubProfanity("")).toBe("");
  });

  it("leaves clean text untouched", () => {
    expect(scrubProfanity("Check out this Solana trading tip!")).toBe("Check out this Solana trading tip!");
  });

  it("masks a flagged word (first letter + asterisks)", () => {
    expect(scrubProfanity("this is shit")).toBe("this is s***");
  });

  it("masks every occurrence, case-insensitively", () => {
    expect(scrubProfanity("Shit, SHIT, SHIT")).toBe("S***, S***, S***");
  });

  it("masks a multi-word hit (motherfucker → m***********) and leaves neighboring words", () => {
    expect(scrubProfanity("that motherfucker lied to me")).toBe("that m*********** lied to me");
  });

  it("does NOT mask benign substrings (assassin stays intact)", () => {
    const scrubbed = scrubProfanity("Assassin's Creed gameplay highlights");
    expect(scrubbed).toContain("Assassin");
  });

  it("the masked output always passes checkProfanity", () => {
    for (const text of [
      "This is such BULLSHIT wait no this is Shit honestly",
      "what the fuck, you absolute dick? no wait, motherfucker",
      "retard and bitch and whore all in one clip",
    ]) {
      expect(checkProfanity(scrubProfanity(text)).pass).toBe(true);
    }
  });
});

describe("evaluateQuality", () => {
  it("passes a normal clip", () => {
    const r = evaluateQuality({ durationSec: 15, width: 1080, height: 1920, hasAudio: true });
    expect(r).toEqual({ pass: true, reasons: [] });
  });

  it("flags too-short clips", () => {
    const r = evaluateQuality({ durationSec: 0.5, width: 1080, height: 1920, hasAudio: true });
    expect(r.pass).toBe(false);
    expect(r.reasons.some((x) => x.includes("too short"))).toBe(true);
  });

  it("flags low resolution", () => {
    const r = evaluateQuality({ durationSec: 10, width: 200, height: 200, hasAudio: true });
    expect(r.pass).toBe(false);
    expect(r.reasons.some((x) => x.includes("resolution too low"))).toBe(true);
  });

  it("flags an unreadable/corrupt probe (zero dimensions)", () => {
    const r = evaluateQuality({ durationSec: 0, width: 0, height: 0, hasAudio: false });
    expect(r.pass).toBe(false);
    expect(r.reasons.some((x) => x.includes("corrupt"))).toBe(true);
  });
});

describe("hasGuardrailsInstalled", () => {
  it("is false with no skills installed", () => {
    expect(hasGuardrailsInstalled(undefined)).toBe(false);
    expect(hasGuardrailsInstalled([])).toBe(false);
    expect(hasGuardrailsInstalled(["video.captions"])).toBe(false);
  });

  it("is true when either catalog id is installed", () => {
    for (const id of GUARDRAILS_SKILL_IDS) {
      expect(hasGuardrailsInstalled([id])).toBe(true);
    }
  });
});

// The gate a CLIPPER agent actually goes through: its installs are agentSkillFiles
// ROWS, never influencers.installedSkills — so checking installedSkills alone left
// Guardrails visible in the App Store and on the canvas while enforcing nothing.
describe("guardrailsEnabled (clipper + influencer install stores)", () => {
  it("is false when neither store has it", () => {
    expect(guardrailsEnabled({})).toBe(false);
    expect(guardrailsEnabled({ installedSkills: ["video.captions"], clipSkillRows: [{ skillId: "clip.captions" }] })).toBe(false);
  });

  it("is true from the influencer store (installedSkills)", () => {
    expect(guardrailsEnabled({ installedSkills: ["video.guardrails"] })).toBe(true);
  });

  it("is true from the clipper store (an installed clip.guardrails row)", () => {
    expect(guardrailsEnabled({ clipSkillRows: [{ skillId: "clip.guardrails" }] })).toBe(true);
    expect(guardrailsEnabled({ clipSkillRows: [{ skillId: "clip.guardrails", wired: true }] })).toBe(true);
  });

  it("is false when the canvas node was removed (wired:false) — same rule as every other clip skill", () => {
    expect(guardrailsEnabled({ clipSkillRows: [{ skillId: "clip.guardrails", wired: false }] })).toBe(false);
  });

  it("still fires from installedSkills even if the clip row is unwired", () => {
    expect(guardrailsEnabled({
      installedSkills: ["clip.guardrails"],
      clipSkillRows: [{ skillId: "clip.guardrails", wired: false }],
    })).toBe(true);
  });
});
