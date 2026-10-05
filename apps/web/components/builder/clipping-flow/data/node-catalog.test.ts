// @vitest-environment node
import { describe, it, expect } from "vitest";
import { CATALOG, CATALOG_GROUPS, CATALOG_BY_KEY } from "./node-catalog";

describe("node catalog", () => {
  it("snapshot: palette structure (keys, kinds, groups, default configs)", () => {
    expect(
      CATALOG.map((c) => ({ key: c.key, kind: c.kind, group: c.group, config: c.makeConfig() })),
    ).toMatchSnapshot();
  });

  it("groups cover every item and BY_KEY is total", () => {
    CATALOG.forEach((c) => {
      expect(CATALOG_GROUPS).toContain(c.group);
      expect(CATALOG_BY_KEY[c.key]).toBe(c);
    });
  });

  it("source default has the clip-length + feel knobs the inspector binds to", () => {
    const src = CATALOG_BY_KEY.source.makeConfig() as unknown as Record<string, unknown>;
    expect(src.clipLengthMin).toBe(20);
    expect(src.clipLengthMax).toBe(45);
    expect(src.maxClips).toBe(1);
  });
});
