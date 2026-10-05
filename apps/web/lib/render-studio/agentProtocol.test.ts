import { describe, expect, it } from "vitest";
import { applyReply, compactCode, currentSection, hasCode, isSmallEdit, parseReply, wantsFootage } from "./agentProtocol";
import { buildDocument, clampComposition, starterFor, validateComposition } from "./compose";
import { readClaudeResponse } from "../server/renderStudioAgent";

describe("parseReply / applyReply", () => {
  const base = starterFor("html");
  it("parses sections, meta and strips fences", () => {
    const r = parseReply('<plan>p</plan><summary>s</summary><meta>{"duration":5}</meta><html>\n<div id="a"></div>\n</html><css>.a{}</css><js>```js\nvello.onSeek(()=>{})\n```</js>');
    expect(r.plan).toBe("p");
    expect(r.meta?.duration).toBe(5);
    expect(r.html).toBe('<div id="a"></div>');
    expect(r.js).toBe("vello.onSeek(()=>{})");
  });
  it("applies a unique patch and reports misses", () => {
    const r = parseReply('<patch target="css"><find>.kicker{</find><replace>.kicker{color:red;</replace></patch><patch target="js"><find>NOPE_NOT_THERE</find><replace>x</replace></patch>');
    const out = applyReply(base, r);
    expect(out.comp.css).toContain(".kicker{color:red;");
    expect(out.failedPatches).toHaveLength(1);
  });
  it("tracks the current streaming section", () => {
    expect(currentSection("<plan>x</plan><css>.a")).toBe("styling");
    expect(currentSection("")).toBe("thinking");
  });
});

describe("parseReply on a prose + markdown-fence reply (what Kie actually returned)", () => {
  const raw = [
    "I can't access the internet in this session, so I can't download it. Upload the logo and I'll put it in.",
    "",
    "Here's a fast-paced racing version you can play now.",
    "",
    "**HTML**",
    "```html",
    '<div class="bg"></div><canvas id="gl"></canvas>',
    "```",
    "",
    "**CSS**",
    "```css",
    ".bg{position:absolute;inset:0}",
    "```",
    "",
    "**JS**",
    "```js",
    "vello.onSeek((t) => {});",
    "```",
    "",
    "When you upload the logo, I'll replace the SVG.",
  ].join("\n");
  it("recovers the composition from fences instead of failing", () => {
    const r = parseReply(raw);
    expect(hasCode(r)).toBe(true);
    expect(r.fromFences).toBe(true);
    expect(r.html).toContain('class="bg"');
    expect(r.css).toBe(".bg{position:absolute;inset:0}");
    expect(r.js).toBe("vello.onSeek((t) => {});");
  });
  it("keeps the prose (without code or headings) as the chat reply", () => {
    const r = parseReply(raw);
    expect(r.prose).toContain("fast-paced racing version");
    expect(r.prose).not.toContain("vello.onSeek");
    expect(r.prose).not.toMatch(/\*\*HTML\*\*/);
  });
  it("a prose-only answer yields a reply and no code", () => {
    const r = parseReply("Which clip should open the video: the pit stop or the start?");
    expect(hasCode(r)).toBe(false);
    expect(r.prose).toMatch(/pit stop/);
  });
});

describe("cost routing + compaction", () => {
  const c = starterFor("html");
  it("routes small tweaks to the cheap model and creative work to Opus", () => {
    expect(isSmallEdit("make the headline bigger", c, true)).toBe(true);
    expect(isSmallEdit("make a new video about F1", c, true)).toBe(false);
    expect(isSmallEdit("make the headline bigger", c, false)).toBe(false);
    expect(isSmallEdit("x".repeat(300), c, true)).toBe(false);
  });
  it("detects footage requests", () => {
    expect(wantsFootage("fast F1 racing intro with b-roll")).toBe(true);
    expect(wantsFootage("make the title gold")).toBe(false);
  });
  it("strips comments and blank lines but keeps URLs", () => {
    const out = compactCode("/* a */\n// note\nconst u = 'https://x.com/a.mp4';\n\n\n  // tail\nfoo();  ");
    expect(out).toBe("const u = 'https://x.com/a.mp4';\nfoo();");
  });
});

describe("compose", () => {
  it("clamps bad input", () => {
    const c = clampComposition({ engine: "html", width: 99999, fps: 500, duration: 9999 });
    expect(c.width).toBeLessThanOrEqual(2160);
    expect(c.fps).toBe(60);
    expect(c.duration).toBe(30);
  });
  it("flags non-deterministic code", () => {
    const c = { ...starterFor("html"), js: "vello.onSeek(()=>{ Math.random() })" };
    expect(validateComposition(c).join()).toMatch(/non-deterministic/);
    expect(validateComposition(starterFor("html"))).toEqual([]);
    expect(validateComposition(starterFor("react"))).toEqual([]);
  });
  it("only loads libs a composition uses and neutralises </script>", () => {
    const html = buildDocument({ ...starterFor("html"), js: starterFor("html").js + "\n// </script>" });
    expect(html).toContain("/render-studio/vendor/three.js");
    expect(html).not.toContain("vendor/gsap.js");
    expect(html.match(/<\/script>/g)!.length).toBeGreaterThan(3);
  });
});

describe("readClaudeResponse", () => {
  const sse = (chunks: string[]) => new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(new TextEncoder().encode(x))); c.close(); } }), { headers: { "content-type": "text/event-stream" } });
  it("assembles Anthropic deltas split across chunks", async () => {
    const seen: number[] = [];
    const text = await readClaudeResponse(sse([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"<pl"}}\n\ndata: {"type":"content_block_delta","delta":{"te',
      'xt":"an>hi</plan>"}}\n\ndata: [DONE]\n\n',
    ]), (f) => seen.push(f.length));
    expect(text).toBe("<plan>hi</plan>");
    expect(seen.length).toBe(2);
  });
  it("handles plain JSON (non-stream) replies", async () => {
    const res = new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { headers: { "content-type": "application/json" } });
    expect(await readClaudeResponse(res, () => {})).toBe("ok");
  });
});
