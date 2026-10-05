import { describe, it, expect } from "vitest";
import {
  VIDEO_STYLES, HOOK_STYLES, SETTINGS, MOODS, CAMERA_STYLES, COLOR_GRADES,
  getStyle,
} from "./videoStyles";

describe("video registries", () => {
  it("every style has a non-empty format and visualTreatment", () => {
    expect(VIDEO_STYLES.length).toBeGreaterThanOrEqual(8);
    for (const s of VIDEO_STYLES) {
      expect(s.id).toBeTruthy();
      expect(s.format.trim().length).toBeGreaterThan(0);
      expect(s.visualTreatment.trim().length).toBeGreaterThan(0);
    }
  });

  it("ids are unique across the style registry", () => {
    const ids = VIDEO_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getStyle returns the def or undefined", () => {
    expect(getStyle("talking_head")?.label).toBeTruthy();
    expect(getStyle("nope")).toBeUndefined();
  });

  it("hook/setting/mood/camera/grade registries are non-empty with fragments", () => {
    for (const reg of [HOOK_STYLES, SETTINGS, MOODS, CAMERA_STYLES, COLOR_GRADES]) {
      expect(reg.length).toBeGreaterThan(0);
      for (const item of reg) expect(item.fragment.trim().length).toBeGreaterThan(0);
    }
  });
});
