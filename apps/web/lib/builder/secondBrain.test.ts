import { describe, expect, it } from "vitest";
import {
  classifyChatTurn,
  mergeBullet,
  referenceBullet,
  normalizeForDedup,
} from "./secondBrain";

describe("classifyChatTurn", () => {
  it("skips empty / whitespace messages", () => {
    expect(classifyChatTurn("").kind).toBe("skip");
    expect(classifyChatTurn("   \n ").kind).toBe("skip");
  });

  it("skips short acknowledgements", () => {
    for (const ack of ["ok", "okay", "thanks", "thank you", "cool", "nice", "great", "sure", "yes", "no", "yep"]) {
      expect(classifyChatTurn(ack).kind).toBe("skip");
    }
  });

  it("skips short commands", () => {
    for (const cmd of ["generate it", "create the video", "make one", "go", "do it", "continue", "next"]) {
      expect(classifyChatTurn(cmd).kind).toBe("skip");
    }
  });

  it("classifies a message containing a URL as a reference and extracts the url", () => {
    const r = classifyChatTurn("check this out https://www.tiktok.com/@x/video/123 it's great");
    expect(r.kind).toBe("reference");
    expect(r.url).toBe("https://www.tiktok.com/@x/video/123");
  });

  it("treats a URL reference even when wrapped in punctuation", () => {
    const r = classifyChatTurn("(https://youtu.be/abc)");
    expect(r.kind).toBe("reference");
    expect(r.url).toBe("https://youtu.be/abc");
  });

  it("classifies messages with a durable keyword as a note", () => {
    expect(classifyChatTurn("my niche is food").kind).toBe("note");
    expect(classifyChatTurn("avoid alcohol topics").kind).toBe("note");
    expect(classifyChatTurn("my audience is gen z").kind).toBe("note");
    expect(classifyChatTurn("I prefer fast-cut editing").kind).toBe("note");
    expect(classifyChatTurn("our brand voice is playful and bold").kind).toBe("note");
  });

  it("SKIPS questions (they are not durable knowledge)", () => {
    expect(classifyChatTurn("how do I connect threads?").kind).toBe("skip");
    expect(classifyChatTurn("what should I post today").kind).toBe("skip");
    expect(classifyChatTurn("can you make a video about my niche?").kind).toBe("skip");
    expect(classifyChatTurn("is the agent connected to tiktok?").kind).toBe("skip");
  });

  it("SKIPS action/command requests (do-something, not knowledge)", () => {
    expect(classifyChatTurn("post something on threads").kind).toBe("skip");
    expect(classifyChatTurn("make a video about cats").kind).toBe("skip");
    expect(classifyChatTurn("find me a campaign to join").kind).toBe("skip");
    expect(classifyChatTurn("tweet about the new drop").kind).toBe("skip");
    expect(classifyChatTurn("schedule a post for tomorrow").kind).toBe("skip");
  });

  it("SKIPS long but non-durable chatter (no length-based saving)", () => {
    expect(classifyChatTurn("I think that sounds pretty good honestly, let's see how it goes").kind).toBe("skip");
  });

  it("returns the trimmed text on a note", () => {
    expect(classifyChatTurn("  my niche is food  ").text).toBe("my niche is food");
  });

  it("a short non-keyword statement that is not an ack is skipped", () => {
    expect(classifyChatTurn("hmm maybe").kind).toBe("skip");
  });
});

describe("normalizeForDedup", () => {
  it("lowercases, trims, and strips trailing punctuation/whitespace", () => {
    expect(normalizeForDedup("  My Niche Is Food! ")).toBe("my niche is food");
    expect(normalizeForDedup("Avoid Alcohol.")).toBe("avoid alcohol");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeForDedup("a   b\tc")).toBe("a b c");
  });
});

describe("mergeBullet", () => {
  it("appends a new bullet under existing content", () => {
    const { content, changed } = mergeBullet("# Notes\n", "my niche is food");
    expect(changed).toBe(true);
    expect(content).toContain("- my niche is food");
  });

  it("does not duplicate an equivalent bullet (case/punct/space insensitive)", () => {
    const base = "# Notes\n- My niche is food";
    const { content, changed } = mergeBullet(base, "my niche is food!");
    expect(changed).toBe(false);
    expect(content).toBe(base);
  });

  it("keeps existing bullets and adds the new one at the end", () => {
    const base = "# Notes\n- one\n- two";
    const { content, changed } = mergeBullet(base, "three");
    expect(changed).toBe(true);
    expect(content).toBe("# Notes\n- one\n- two\n- three");
  });
});

describe("referenceBullet", () => {
  it("formats a url into a bullet body", () => {
    expect(referenceBullet("https://youtu.be/abc")).toContain("https://youtu.be/abc");
  });

  it("includes an optional note", () => {
    expect(referenceBullet("https://youtu.be/abc", "format study")).toContain("format study");
  });
});
