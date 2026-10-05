// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { errorResponse, internalSecret, parseBigint, readBoundedJson } from "./solstarRoute";

const req = (body: string, headers?: Record<string, string>) =>
  new NextRequest("http://x/api", { method: "POST", body, headers });
afterEach(() => { vi.unstubAllEnvs(); });

describe("parseBigint", () => {
  it("accepts plain decimal strings only", () => {
    expect(parseBigint("123")).toBe(123n);
    for (const bad of ["-1", "1.5", "1e9", "", "12345678901234567890", 123, null, undefined, " 1"]) {
      expect(parseBigint(bad)).toBeNull();
    }
  });
});
describe("parseBigint int64 bound", () => {
  it("rejects values above int64 max", () => {
    expect(parseBigint("9223372036854775807")).toBe(9223372036854775807n);
    expect(parseBigint("9223372036854775808")).toBeNull();
    expect(parseBigint("9999999999999999999")).toBeNull();
  });
});
describe("readBoundedJson", () => {
  it("413 over the limit, 400 on malformed, ok otherwise", async () => {
    const big = await readBoundedJson(req("x".repeat(5000)));
    expect(big.ok === false && big.res.status).toBe(413);
    const bad = await readBoundedJson(req("{not json"));
    expect(bad.ok === false && bad.res.status).toBe(400);
    const ok = await readBoundedJson(req('{"a":1}'));
    expect(ok).toEqual({ ok: true, body: { a: 1 } });
  });
  it("rejects on declared content-length without reading, and never calls json()", async () => {
    const r = req('{"a":1}', { "content-length": "99999" });
    const json = vi.spyOn(r, "json");
    const text = vi.spyOn(r, "text");
    const out = await readBoundedJson(r);
    expect(out.ok === false && out.res.status).toBe(413);
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });
  it("counts multibyte bytes, not characters", async () => {
    const out = await readBoundedJson(req("é".repeat(2100)));
    expect(out.ok === false && out.res.status).toBe(413);
  });
});
describe("internalSecret", () => {
  it("returns the env secret, null when missing or empty", () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", "s3");
    expect(internalSecret()).toBe("s3");
    vi.stubEnv("INTERNAL_CRON_SECRET", "");
    expect(internalSecret()).toBeNull();
  });
});
describe("errorResponse", () => {
  const status = async (m: string) => {
    const res = errorResponse(new Error(m));
    return { status: res.status, body: await res.json() };
  };
  it("maps known codes", async () => {
    expect((await status("quote_expired")).status).toBe(409);
    expect((await status("slippage_exceeded")).status).toBe(409);
    expect((await status("idempotency_conflict")).status).toBe(409);
    expect((await status("insufficient_balance")).status).toBe(422);
    expect((await status("insufficient_position")).status).toBe(422);
    expect((await status("invalid_amount")).status).toBe(400);
    expect((await status("not_paper_token")).status).toBe(400);
    expect((await status("invalid_wallet")).status).toBe(400);
    expect((await status("invalid_key")).status).toBe(400);
    expect((await status("character_not_found")).status).toBe(404);
    expect((await status("rate_limited")).status).toBe(429);
    expect((await status("invalid_body")).status).toBe(400);
    expect((await status("duplicate_message")).status).toBe(409);
    expect((await status("token_not_found")).status).toBe(404);
  });
  it("maps character-creation codes", async () => {
    for (const [code, st] of [
      ["ticker_taken", 409], ["idempotency_conflict", 409], ["create_limit", 429],
      ["invalid_name", 400], ["invalid_ticker", 400], ["invalid_bio", 400], ["invalid_category", 400],
      ["invalid_image", 400], ["rights_required", 400], ["invalid_key", 400],
    ] as const) {
      expect(await status(code)).toEqual({ status: st, body: { error: code } });
    }
  });
  it("matches codes inside wrapped Convex messages", async () => {
    const r = await status("[Request ID: x] Server Error Uncaught Error: slippage_exceeded at handler");
    expect(r).toEqual({ status: 409, body: { error: "slippage_exceeded" } });
  });
  it("maps malformed ids to 400 invalid_id", async () => {
    for (const m of ["ArgumentValidationError: Value does not match validator", "Invalid argument `id`", "Unable to decode ID"]) {
      expect(await status(m)).toEqual({ status: 400, body: { error: "invalid_id" } });
    }
  });
  it("hides unknown errors", async () => {
    const r = await status("db password is hunter2");
    expect(r).toEqual({ status: 500, body: { error: "internal_error" } });
    expect((await errorResponse("weird").json())).toEqual({ error: "internal_error" });
  });
});
