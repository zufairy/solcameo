import { HOOK_FONT_FAMILY } from "./hookFonts";
import { toAssColor, toAssTime } from "./assUtils";
import type { HookDesignRender } from "@/lib/builder/hookDesigns";

// Vertical anchor → ASS alignment (numpad): top=8, center=5, bottom=2.
const ALIGN = { top: 8, center: 5, bottom: 2 } as const;

// Strip ASS-breaking chars; collapse whitespace.
const sanitize = (raw: string): string => raw.replace(/[\r\n]+/g, " ").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();

/**
 * Render a hook line as an animated ASS overlay. Unlike the old static drawtext
 * burn, ASS gives smooth entrance/exit animations (via `\fad` + `\t`) and named
 * industry fonts (via the template's `font` token → bundled family, resolved by
 * libass through `subtitles=...:fontsdir=<hookFontsDir()>`).
 *
 * The style pins SAFE PADDING (MarginL/R/V insets) so the text never touches an
 * edge — professional, centred framing in any orientation. Position maps to ASS
 * Alignment. `word-reveal` emits one Dialogue per word so words build in over the
 * duration; every other animation is a single styled event.
 */
export function renderHookAss(
  text: string,
  opts: { render: HookDesignRender; durationSec: number; width: number; height: number },
): string {
  const { render: r, durationSec, width, height } = opts;
  const family = HOOK_FONT_FAMILY[r.font] ?? "Arial";
  const clean = sanitize(r.allCaps ? text.toUpperCase() : text);
  const words = clean.split(" ").filter(Boolean);
  const dur = Math.max(0.5, durationSec);

  // Template sizes are authored at a 1080×1920 reference — scale to the real
  // canvas so a 720p clip renders the same proportional size, not oversized px.
  const fontSize = Math.round(r.fontSize * Math.max(0.5, Math.min(1.2, height / 1920)));

  // Safe padding so text is always inset from the frame edges.
  const marginLR = Math.round(width * 0.06);
  const marginV = Math.round(height * 0.08);
  const align = ALIGN[r.position];
  const borderStyle = r.boxColor ? 3 : 1; // 3 = opaque box behind text
  const backColour = r.boxColor ? toAssColor(r.boxColor) : "&H64000000";

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Bold=0: the bundled font IS already the intended weight (Medium/SemiBold), so
    // synthetic-bolding it just makes it look clumsy/heavy — keep the real weight.
    `Style: Hook,${family},${fontSize},${toAssColor(r.fontColor)},&H000000FF,${toAssColor(r.outlineColor)},${backColour},0,0,0,0,100,100,0,0,${borderStyle},${r.outlineWidth},0,${align},${marginLR},${marginLR},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  // Resting anchor for \move-based animations (all templates are horizontally
  // centred). yRest tracks the ASS alignment anchor for the chosen band.
  const cx = Math.round(width / 2);
  const yRest = r.position === "top" ? marginV : r.position === "bottom" ? height - marginV : Math.round(height / 2);

  const events: string[] = [];
  const end = toAssTime(dur);

  if (r.animation === "word-reveal") {
    const per = dur / Math.max(1, words.length);
    for (let i = 0; i < words.length; i++) {
      const shown = words.slice(0, i + 1).join(" ");
      // Each step ends when the NEXT word appears (the final, full line holds to
      // `end`). Without this every event ran to `end`, so all the progressively
      // longer lines were on-screen at once and libass stacked them into a ghosted
      // pile instead of building word-by-word.
      const evEnd = i < words.length - 1 ? toAssTime((i + 1) * per) : end;
      events.push(`Dialogue: 0,${toAssTime(i * per)},${evEnd},Hook,,0,0,0,,{\\fad(80,0)}${shown}`);
    }
  } else {
    events.push(`Dialogue: 0,${toAssTime(0)},${end},Hook,,0,0,0,,{${entranceTag(r.animation, align, cx, yRest)}}${clean}`);
  }

  return `${header}\n${events.join("\n")}\n`;
}

/** ASS override tags for a template's entrance/exit animation (times in ms).
 *  `slide-down` uses \move against the RESOLVED resting anchor (cx,yRest) — \move
 *  takes absolute coords, so it must be pinned with an explicit \an to the same
 *  alignment or it would fling the text to the corner. */
function entranceTag(anim: HookDesignRender["animation"], align: number, cx: number, yRest: number): string {
  switch (anim) {
    case "pop":
      // Scale up from 60% with a soft fade — a clean spring-in.
      return `\\fscx60\\fscy60\\fad(60,180)\\t(0,180,\\fscx100\\fscy100)`;
    case "pop-overshoot":
      // Overshoot to 110% then settle to 100% — punchy.
      return `\\fscx45\\fscy45\\fad(50,180)\\t(0,140,\\fscx110\\fscy110)\\t(140,220,\\fscx100\\fscy100)`;
    case "slide-down":
      // Drop in from ~48px above the resting anchor while fading in.
      return `\\an${align}\\fad(150,180)\\move(${cx},${yRest - 48},${cx},${yRest},0,240)`;
    case "fade":
    default:
      return `\\fad(180,180)`;
  }
}
