import { describe, it, expect } from "vitest";
import { extractActionBlock, extractAllActionBlocks, stripActionTags } from "./chatActionBlocks";

describe("chat action blocks", () => {
  it("parses a block with NO closing tag (the raw [OPEN_BUILDER] that leaked into chat)", () => {
    const msg = 'Let\'s get that script locked in.\n\n[OPEN_BUILDER]{"tab":"ideas"}';
    const b = extractActionBlock(msg, "OPEN_BUILDER")!;
    expect(JSON.parse(b[1])).toEqual({ tab: "ideas" });
    expect(msg.replace(b[0], "").trim()).toBe("Let's get that script locked in.");
  });

  it("parses the well-formed version and includes the closing tag in the stripped block", () => {
    const msg = 'Opening it.\n[OPEN_BUILDER]{"tab":"ideas"}[/OPEN_BUILDER]';
    const b = extractActionBlock(msg, "OPEN_BUILDER")!;
    expect(b[0]).toBe('[OPEN_BUILDER]{"tab":"ideas"}[/OPEN_BUILDER]');
  });

  it("keeps NESTED json intact (a lazy regex cut BIBLE_PATCH ops at the first brace)", () => {
    const msg = 'ok [BIBLE_PATCH]{"ops":[{"op":"set_tone","value":"calm"},{"op":"posts","value":2}]}[/BIBLE_PATCH]';
    const b = extractActionBlock(msg, "BIBLE_PATCH")!;
    expect(JSON.parse(b[1]).ops).toHaveLength(2);
  });

  it("handles braces inside JSON strings", () => {
    const msg = '[SAVE_IDEA]{"headline":"The } trick","angle":"why {this} works"}[/SAVE_IDEA]';
    expect(JSON.parse(extractActionBlock(msg, "SAVE_IDEA")![1]).headline).toBe("The } trick");
  });

  it("finds every [SAVE_IDEA] in one reply", () => {
    const msg = 'Three ideas:\n[SAVE_IDEA]{"headline":"A","angle":"a"}[/SAVE_IDEA]\n[SAVE_IDEA]{"headline":"B","angle":"b"}\n[SAVE_IDEA]{"headline":"C","angle":"c"}[/SAVE_IDEA]';
    expect(extractAllActionBlocks(msg, "SAVE_IDEA").map((b) => JSON.parse(b[1]).headline)).toEqual(["A", "B", "C"]);
  });

  it("stripActionTags removes every tag form — well-formed, unclosed, orphan closer", () => {
    const msg = 'Hi!\n[OPEN_BUILDER]{"tab":"ideas"}\n[SHOW_VIDEOS]{"count":2}[/SHOW_VIDEOS]\n[/GENERATE_VIDEO]';
    expect(stripActionTags(msg)).toBe("Hi!");
  });
});
