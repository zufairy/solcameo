import { describe, it, expect } from "vitest";
import { extractClaudeJson } from "./kie-claude";

describe("extractClaudeJson", () => {
  it("parses a raw JSON object", () => {
    expect(extractClaudeJson('{"hook":"hi","script":"there"}')).toEqual({ hook: "hi", script: "there" });
  });

  it("strips ```json fences (the shape Haiku returns)", () => {
    const raw = "```json\n{\n  \"hook\": \"You're doing it wrong\",\n  \"script\": \"Listen up\"\n}\n```";
    expect(extractClaudeJson(raw)).toEqual({ hook: "You're doing it wrong", script: "Listen up" });
  });

  it("extracts a JSON object embedded in prose", () => {
    const raw = 'Sure! Here is your script: {"hook":"a","script":"b","hashtags":["#x"]} — enjoy';
    expect(extractClaudeJson(raw)).toEqual({ hook: "a", script: "b", hashtags: ["#x"] });
  });

  it("tolerates a trailing comma", () => {
    expect(extractClaudeJson('{"hook":"a","script":"b",}')).toEqual({ hook: "a", script: "b" });
  });

  it("returns null when there is no JSON object", () => {
    expect(extractClaudeJson("no json here")).toBeNull();
  });

  it("skips a non-parseable first object and finds a later valid one", () => {
    // First {...} is malformed (unquoted, unparseable); the real transcript
    // object follows. Old behavior returned null on the first failure.
    const raw = 'note: {oops not json} then the real one: {"duration":3,"segments":[]}';
    expect(extractClaudeJson(raw)).toEqual({ duration: 3, segments: [] });
  });

  it("returns the first object when multiple valid objects are present", () => {
    expect(extractClaudeJson('{"a":1} {"b":2}')).toEqual({ a: 1 });
  });
});
