import { describe, it, expect } from "vitest";
import { renderCaptionsAss, chunkWords, pickZoomPunchTimes } from "./captionRenderer";
import type { TranscriptWord, CaptionStyle } from "./clipTypes";

const words: TranscriptWord[] = [
  { word: "Hello", start: 10.0, end: 10.4 },
  { word: "world", start: 10.5, end: 11.0 },
  { word: "again", start: 30.0, end: 30.5 },
];
const style: CaptionStyle = { mode: "line", fontColor: "#FFEE00", fontSize: 48, position: "bottom" };

describe("renderCaptionsAss — non-latin font selection", () => {
  it("uses a CJK font when the captions contain CJK glyphs (no tofu)", () => {
    const cjk: TranscriptWord[] = [{ word: "你好", start: 10, end: 10.5 }, { word: "世界", start: 10.6, end: 11 }];
    const ass = renderCaptionsAss(cjk, { clipStartSec: 10, clipEndSec: 12, style });
    expect(ass).toContain("Noto Sans CJK");
    expect(ass).not.toContain("Def,Arial,");
  });
  it("keeps the latin font for latin (English/Malay/Spanish) captions", () => {
    const ass = renderCaptionsAss(words, { clipStartSec: 10, clipEndSec: 12, style });
    expect(ass).toContain("Def,Arial,");
    expect(ass).not.toContain("Noto Sans");
  });
  it("uses the KOREAN font for Hangul (its range overlaps the CJK block — must check first)", () => {
    const korean: TranscriptWord[] = [{ word: "안녕", start: 10, end: 10.5 }];
    const ass = renderCaptionsAss(korean, { clipStartSec: 10, clipEndSec: 12, style });
    expect(ass).toContain("Noto Sans CJK KR");
    expect(ass).not.toContain("Noto Sans CJK SC");
  });
});

describe("renderCaptionsAss (legacy path)", () => {
  it("emits an ASS header + only words inside the window, rebased to clip start", () => {
    const ass = renderCaptionsAss(words, { clipStartSec: 10, clipEndSec: 12, style });
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("[Events]");
    expect(ass).toContain("Hello world");
    expect(ass).not.toContain("again");
    expect(ass).toContain("0:00:00.00");
  });

  it("emits one Dialogue per word in karaoke mode", () => {
    const ass = renderCaptionsAss(words, { clipStartSec: 10, clipEndSec: 12, style: { ...style, mode: "karaoke" } });
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues.length).toBe(2);
  });

  it("an unknown preset id degrades to the legacy path", () => {
    const ass = renderCaptionsAss(words, { clipStartSec: 10, clipEndSec: 12, style: { ...style, mode: "karaoke", preset: "nope" } });
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues.length).toBe(2); // one per word, no chunk re-render
    expect(ass).toContain("Style: Def,Arial,48");
  });
});

describe("renderCaptionsAss — dragged yPct (Editor tab drag-to-position)", () => {
  it("centres EVERY caption event exactly on yPct% (\\an5\\pos) — same anchor as the preview's translateY(-50%)", () => {
    const ass = renderCaptionsAss(words, { clipStartSec: 10, clipEndSec: 12, style: { ...style, position: "bottom", yPct: 40 }, height: 1920 });
    const styleLine = ass.split("\n").find((l) => l.startsWith("Style: Def,"))!;
    expect(styleLine.split(",")[18]).toBe("5"); // Alignment: middle-centre
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues.length).toBeGreaterThan(0);
    // centre-x of the 1080 canvas, 40% of 1920 — for every event, however many lines it wraps to
    for (const d of dialogues) expect(d).toContain("{\\an5\\pos(540,768)}");
  });
  it("clamps yPct to [2,92] so a dragged caption never goes fully off-frame", () => {
    const assTop = renderCaptionsAss(words, { clipStartSec: 10, clipEndSec: 12, style: { ...style, yPct: -50 }, height: 1000 });
    const assBottom = renderCaptionsAss(words, { clipStartSec: 10, clipEndSec: 12, style: { ...style, yPct: 500 }, height: 1000 });
    expect(assTop).toContain("\\pos(540,20)");     // 2% of 1000
    expect(assBottom).toContain("\\pos(540,920)"); // 92% of 1000
  });
  it("ignores yPct entirely inside a clip pane (pane spot positioning always wins)", () => {
    const ass = renderCaptionsAss(words, { clipStartSec: 10, clipEndSec: 12, style: { ...style, yPct: 40 }, height: 1920, clipPane: { layout: "vstack", spot: "center" } });
    const fields = ass.split("\n").find((l) => l.startsWith("Style: Def,"))!.split(",");
    expect(fields[18]).toBe("5"); // centered inside the pane, not alignment 8
  });
  it("no yPct set: falls back to the existing fixed position bands, unchanged", () => {
    const ass = renderCaptionsAss(words, { clipStartSec: 10, clipEndSec: 12, style: { ...style, position: "top" }, height: 1920 });
    const fields = ass.split("\n").find((l) => l.startsWith("Style: Def,"))!.split(",");
    expect(fields[18]).toBe("8"); // ALIGN.top
  });
});

describe("chunkWords", () => {
  const mk = (n: number, gapAt?: number): TranscriptWord[] =>
    Array.from({ length: n }, (_, i) => ({
      word: `w${i}`,
      start: i + (gapAt !== undefined && i >= gapAt ? 2 : 0),
      end: i + 0.5 + (gapAt !== undefined && i >= gapAt ? 2 : 0),
    }));

  it("caps pages at the requested size", () => {
    const pages = chunkWords(mk(9), 4);
    expect(pages.map((p) => p.length)).toEqual([4, 4, 1]);
  });

  it("breaks pages at speech gaps > 1.2s", () => {
    const pages = chunkWords(mk(6, 3), 10);
    expect(pages.length).toBe(2);
    expect(pages[0].length).toBe(3);
  });

  it("breaks pages at sentence punctuation", () => {
    const ws: TranscriptWord[] = [
      { word: "Done.", start: 0, end: 0.4 },
      { word: "Next", start: 0.5, end: 0.9 },
    ];
    const pages = chunkWords(ws, 10);
    expect(pages.length).toBe(2);
  });
});

describe("toAssColor validation (via highlight path)", () => {
  const win = { clipStartSec: 10, clipEndSec: 12 };
  // The emphasis word "biggest" triggers the highlight override block, so the
  // emitted {\c...} reflects toAssColor(style.highlightColor).
  const emph: TranscriptWord[] = [{ word: "biggest", start: 10, end: 10.5 }];

  it("a valid #hex highlight still renders the expected ASS color", () => {
    const ass = renderCaptionsAss(emph, { ...win, style: { ...style, highlightColor: "#FFD700" } });
    expect(ass).toContain("\\c&H0000D7FF"); // #FFD700 → BGR &H0000D7FF
  });

  it("a non-hex color word ('red') falls back to opaque white, not garbage", () => {
    const ass = renderCaptionsAss(emph, { ...win, style: { ...style, highlightColor: "red" } });
    expect(ass).toContain("\\c&H00FFFFFF"); // safe fallback
    expect(ass).not.toContain("\\cRED");
  });

  it("a brace/colon-bearing color ('}{bad') cannot break the override block", () => {
    const ass = renderCaptionsAss(emph, { ...win, style: { ...style, highlightColor: "}{bad" } });
    expect(ass).toContain("\\c&H00FFFFFF"); // safe fallback
    const dialogue = ass.split("\n").find((l) => l.startsWith("Dialogue:"))!;
    // No stray braces injected — every "{" is matched by a "}".
    expect((dialogue.match(/{/g) ?? []).length).toBe((dialogue.match(/}/g) ?? []).length);
    expect(dialogue).not.toContain("}{bad");
  });
});

describe("renderCaptionsAss (preset engine)", () => {
  const win = { clipStartSec: 10, clipEndSec: 12 };

  it("karaoke preset: whole page per event, active word recolored + scaled", () => {
    const ass = renderCaptionsAss(words, { ...win, style: { ...style, preset: "karaoke" } });
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues.length).toBe(2); // 2 in-window words → 2 frames of the same page
    // Both words visible in each event, ALL CAPS.
    expect(dialogues[0]).toContain("HELLO");
    expect(dialogues[0]).toContain("WORLD");
    // Active word recolors OpusClip green on frame 0. The page now has a "float"
    // entrance, so the first frame carries the entrance tween and the per-word 130%
    // scale-pop appears from the SECOND word onward (\t eased, not an instant snap).
    expect(dialogues[0]).toContain("\\c&H0027F804"); // OpusClip green, ASS BGR order
    expect(dialogues[0]).toMatch(/\\fscx90\\fscy90\\fad/); // page float entrance on frame 0
    expect(dialogues[1]).toContain("\\t(0,150,0.6,\\fscx130\\fscy130)"); // eased per-word pop
    // Frame 1 holds until the next word starts (no flicker gap).
    expect(dialogues[0]).toContain("0:00:00.50");
  });

  it("preset overrides the style line (font size, outline, margin)", () => {
    const ass = renderCaptionsAss(words, { ...win, style: { ...style, preset: "karaoke" } });
    expect(ass).toContain("Style: Def,Bebas Neue,78"); // preset font + size, not style.fontSize
    expect(ass).toContain("ScaledBorderAndShadow: yes");
    expect(ass).toContain(`,${Math.round(1920 * 0.19)},1`); // OpusClip ~19% bottom margin
  });

  it("deep diver: pill box style + spoken words keep the ink", () => {
    const ass = renderCaptionsAss(words, { ...win, style: { ...style, preset: "deepdiver" } });
    expect(ass).toContain("&H00E4E4E4"); // pill BackColour
    const styleLine = ass.split("\n").find((l) => l.startsWith("Style:"))!;
    expect(styleLine).toContain(",3,10,0,"); // BorderStyle=3, Outline(pad)=10 (captionPillPadding), Shadow=0
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    // Second frame: first word already spoken → stays inked black.
    expect(dialogues[1]).toContain("\\c&H00000000}");
  });

  it("popline: active word underlined and reset", () => {
    const ass = renderCaptionsAss(words, { ...win, style: { ...style, preset: "popline" } });
    expect(ass).toContain("\\u1");
    expect(ass).toContain("\\u0");
  });

  it("bounce: smooth eased page-enter animation on the first frame only", () => {
    const ass = renderCaptionsAss(words, { ...win, style: { ...style, preset: "bounce" } });
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    // popIn maps to the smoother "pop" entrance: a quick fade + eased scale-up to 100%.
    expect(dialogues[0]).toContain("\\fad(");
    expect(dialogues[0]).toContain("\\t(0,190,0.7,\\fscx100\\fscy100)");
    // The page-ENTER fade/scale plays once (first frame only) — no re-fade, no
    // entrance re-animation on subsequent frames …
    expect(dialogues[1]).not.toContain("\\fad(");
    expect(dialogues[1]).not.toContain("\\t(0,190,");
    // … but every spoken word now gets a smooth per-word pop tween (100%→activeScale
    // over 120ms) so the highlight springs in instead of snapping.
    expect(dialogues[1]).toContain("\\t(0,150,0.6,\\fscx120\\fscy120)");
  });

  it("entrance: fade preset fades the page in without a scale tween", () => {
    const ass = renderCaptionsAss(words, { ...win, style: { ...style, preset: "mono" } });
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues[0]).toContain("\\fad(160,0)");
    expect(dialogues[0]).not.toContain("\\t(");
  });

  it("entrance: float preset fades + eases the page up (elegant/premium)", () => {
    const ass = renderCaptionsAss(words, { ...win, style: { ...style, preset: "gold" } });
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues[0]).toContain("\\fad(150,0)");
    expect(dialogues[0]).toContain("\\t(0,240,0.6,\\fscx100\\fscy100)");
  });

  it("mozi: static keyword recolor, no active-word motion", () => {
    const kw: TranscriptWord[] = [
      { word: "money", start: 10.0, end: 10.4 },
      { word: "and", start: 10.5, end: 11.0 },
    ];
    const ass = renderCaptionsAss(kw, { ...win, style: { ...style, preset: "mozi" } });
    expect(ass).toContain("\\c&H0027F805"); // keyword green on "money"
    expect(ass).not.toContain("\\fscx130");
  });

  it("strips ASS braces from transcript words (tag injection)", () => {
    const evil: TranscriptWord[] = [{ word: "{\\an8}hi", start: 10, end: 10.5 }];
    const ass = renderCaptionsAss(evil, { ...win, style: { ...style, preset: "karaoke" } });
    expect(ass).not.toContain("{\\an8}");
  });
});

describe("renderCaptionsAss — brain-rot clip-pane positioning", () => {
  const win = { clipStartSec: 10, clipEndSec: 12, width: 1080, height: 1920 };

  it("no clipPane → full-frame PlayRes + position-based alignment (unchanged)", () => {
    const ass = renderCaptionsAss(words, { ...win, style });
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    // alignment 2 (bottom) for position:"bottom"
    expect(ass).toMatch(/,2,40,40,/);
  });

  it("vstack pane → PlayRes is the half-HEIGHT pane and the caption centers (align 5)", () => {
    const ass = renderCaptionsAss(words, { ...win, style, clipPane: { layout: "vstack", spot: "center" } });
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 960"); // 1920 / 2 — the clip pane
    expect(ass).toMatch(/,5,40,40,/); // middle-center, inside the clip pane
  });

  it("hstack pane → PlayRes is the half-WIDTH pane", () => {
    const ass = renderCaptionsAss(words, { ...win, style, clipPane: { layout: "hstack", spot: "center" } });
    expect(ass).toContain("PlayResX: 540"); // 1080 / 2 — the clip pane
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toMatch(/,5,40,40,/);
  });

  it("bottom caption uses a platform-safe margin (>= 12% of height) even legacy", () => {
    const ass = renderCaptionsAss(words, { ...win, style: { ...style, position: "bottom" } });
    // legacy bottom margin raised from 120 to round(1920*0.12)=230 so it clears the platform caption zone
    expect(ass).toMatch(/,2,40,40,230,/);
  });

  it("top caption is NOT bottom-floored (keeps its own margin)", () => {
    const ass = renderCaptionsAss(words, { ...win, style: { ...style, position: "top" } });
    expect(ass).toMatch(/,8,40,40,120,/);
  });

  it("spot:'bottom' keeps the style's own alignment (bottom)", () => {
    const ass = renderCaptionsAss(words, { ...win, style, clipPane: { layout: "vstack", spot: "bottom" } });
    expect(ass).toContain("PlayResY: 960");
    expect(ass).toMatch(/,2,40,40,/); // still bottom-anchored, but within the pane
  });
});

describe("renderCaptionsAss — bug-hunt regressions (2026-06-29)", () => {
  it("[#15] line mode PAGES the transcript instead of one wall-of-text Dialogue", () => {
    const many: TranscriptWord[] = Array.from({ length: 14 }, (_, i) => ({ word: `w${i}`, start: 10 + i, end: 10 + i + 0.5 }));
    const ass = renderCaptionsAss(many, { clipStartSec: 10, clipEndSec: 30, style }); // style.mode === "line"
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues.length).toBe(3); // 14 words / 6-per-page = 3 pages — was 1 static event with all 14
  });

  it("[#16] Keyword Pop highlight bridges into a non-keyword preset (karaoke + emoji + highlightColor → green keyword)", () => {
    const kw: TranscriptWord[] = [
      { word: "money", start: 10.0, end: 10.4 }, // a KEYWORDS-class word
      { word: "talks", start: 10.5, end: 11.0 },
    ];
    const ass = renderCaptionsAss(kw, { clipStartSec: 10, clipEndSec: 12, style: { ...style, mode: "karaoke", preset: "karaoke", emoji: true, highlightColor: "#05F827" } });
    expect(ass).toContain("\\c&H0027F805"); // #05F827 keyword green — was silently dropped on the preset path
  });
});

describe("renderCaptionsAss — emoji / broken-symbol stripping (text only)", () => {
  it("strips emoji from caption words so libass never burns tofu", () => {
    const emojiWords: TranscriptWord[] = [
      { word: "This", start: 10.0, end: 10.3 },
      { word: "is", start: 10.3, end: 10.5 },
      { word: "🔥", start: 10.5, end: 10.8 },
      { word: "insane💯", start: 10.8, end: 11.3 },
      { word: "➡️", start: 11.3, end: 11.5 },
      { word: "watch", start: 11.5, end: 12.0 },
    ];
    const ass = renderCaptionsAss(emojiWords, { clipStartSec: 10, clipEndSec: 12.5, style });
    // No emoji / pictograph / variation-selector codepoints survive into the ASS.
    const tofu = ass.match(/[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu) ?? [];
    expect(tofu).toHaveLength(0);
    // The real words still render.
    expect(ass).toContain("This");
    expect(ass).toContain("insane");
    expect(ass).toContain("watch");
  });
});

describe("pickZoomPunchTimes (Specials tool)", () => {
  it("returns a punch time for a keyword word, none for a plain transcript", () => {
    const plain: TranscriptWord[] = [
      { word: "so", start: 0, end: 0.3 },
      { word: "anyway", start: 0.3, end: 0.7 },
      { word: "we", start: 0.7, end: 0.9 },
      { word: "went", start: 0.9, end: 1.2 },
    ];
    expect(pickZoomPunchTimes(plain)).toEqual([]);

    const withKeyword: TranscriptWord[] = [
      { word: "we", start: 0, end: 0.3 },
      { word: "made", start: 0.3, end: 0.6 },
      { word: "insane", start: 0.6, end: 1.0 }, // matches KEYWORDS
      { word: "money", start: 1.0, end: 1.3 },
    ];
    const times = pickZoomPunchTimes(withKeyword);
    expect(times.length).toBeGreaterThan(0);
    expect(times[0]).toBeCloseTo(0.6, 5);
  });

  it("caps at `max` beats even with a keyword-dense transcript", () => {
    const words: TranscriptWord[] = Array.from({ length: 10 }, (_, i) => ({
      word: "insane", start: i * 5, end: i * 5 + 0.3, // 5s apart -> clears any minGap
    }));
    expect(pickZoomPunchTimes(words, { max: 2 })).toHaveLength(2);
  });

  it("enforces minGapSec — a cluster of keywords only punches once per gap window", () => {
    const words: TranscriptWord[] = [
      { word: "insane", start: 0, end: 0.3 },
      { word: "amazing", start: 0.5, end: 0.8 }, // within default 3s gap of the first
      { word: "crazy", start: 8, end: 8.3 },     // clears the gap -> counts
    ];
    const times = pickZoomPunchTimes(words);
    expect(times).toEqual([0, 8]);
  });

  it("empty transcript -> no punches", () => {
    expect(pickZoomPunchTimes([])).toEqual([]);
  });
});
