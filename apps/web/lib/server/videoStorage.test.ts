import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isR2StorageId,
  r2KeyFromStorageId,
  makeVideoKey,
  r2PublicUrl,
  r2Configured,
} from "./videoStorage";

const R2_ENV = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE_URL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(R2_ENV.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of R2_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function setAllR2Env() {
  process.env.R2_ACCOUNT_ID = "acct";
  process.env.R2_ACCESS_KEY_ID = "key";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
  process.env.R2_BUCKET = "vello-videos";
  process.env.R2_PUBLIC_BASE_URL = "https://videos.example.com";
}

describe("isR2StorageId / r2KeyFromStorageId", () => {
  it("recognizes r2-prefixed ids and extracts the key", () => {
    expect(isR2StorageId("r2:clips/2026-08-24/abc.mp4")).toBe(true);
    expect(r2KeyFromStorageId("r2:clips/2026-08-24/abc.mp4")).toBe("clips/2026-08-24/abc.mp4");
  });
  it("rejects convex storage ids", () => {
    expect(isR2StorageId("kg2abc123convexid")).toBe(false);
    expect(r2KeyFromStorageId("kg2abc123convexid")).toBeNull();
  });
});

describe("makeVideoKey", () => {
  it("builds prefix/date/uuid.mp4", () => {
    const key = makeVideoKey("clips");
    expect(key).toMatch(/^clips\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.mp4$/);
  });
  it("sanitizes weird prefixes", () => {
    expect(makeVideoKey("../evil")).toMatch(/^evil\//);
  });
});

describe("r2PublicUrl", () => {
  it("joins base and key without double slashes", () => {
    setAllR2Env();
    process.env.R2_PUBLIC_BASE_URL = "https://videos.example.com/";
    expect(r2PublicUrl("clips/a.mp4")).toBe("https://videos.example.com/clips/a.mp4");
  });
});

describe("r2Configured", () => {
  it("false when any env var missing", () => {
    setAllR2Env();
    delete process.env.R2_SECRET_ACCESS_KEY;
    expect(r2Configured()).toBe(false);
  });
  it("true when all set", () => {
    setAllR2Env();
    expect(r2Configured()).toBe(true);
  });
});
