import { describe, it, expect } from "vitest";
import { CATEGORIES, normalizeTicker, validateConcept, validateImageFile } from "./createForm";

const ok = { name: "Dino", ticker: "DINO", bio: "", category: "Comedy" };

describe("CATEGORIES", () => {
  it("is the fixed list", () => {
    expect(CATEGORIES).toEqual(["Comedy", "Culture", "Music", "Gaming", "Food", "Fashion", "Tech", "Other"]);
  });
});

describe("normalizeTicker", () => {
  it("uppercases, strips non-alphanumerics, caps at 10", () => {
    expect(normalizeTicker("dino")).toBe("DINO");
    expect(normalizeTicker("$d-i n_o!")).toBe("DINO");
    expect(normalizeTicker("abcdefghijklmn")).toBe("ABCDEFGHIJ");
    expect(normalizeTicker("")).toBe("");
  });
});

describe("validateConcept", () => {
  it("accepts a valid concept", () => { expect(validateConcept(ok)).toEqual({ ok: true }); });
  it.each([[1, false], [2, true], [32, true], [33, false]])("name length %i valid=%s", (n, valid) => {
    const r = validateConcept({ ...ok, name: "a".repeat(n) });
    expect(r.ok).toBe(valid);
    if (!r.ok) expect(r.errors.name).toBeTruthy();
  });
  it("trims and strips invisibles before counting", () => {
    expect(validateConcept({ ...ok, name: "  a​ " }).ok).toBe(false);
  });
  it.each([[1, false], [2, true], [10, true], [11, false]])("ticker length %i valid=%s", (n, valid) => {
    const r = validateConcept({ ...ok, ticker: "A".repeat(n) });
    expect(r.ok).toBe(valid);
    if (!r.ok) expect(r.errors.ticker).toBeTruthy();
  });
  it("rejects lowercase / symbols in ticker", () => {
    expect(validateConcept({ ...ok, ticker: "din" }).ok).toBe(false);
    expect(validateConcept({ ...ok, ticker: "DI-N" }).ok).toBe(false);
  });
  it.each([[0, true], [280, true], [281, false]])("bio length %i valid=%s", (n, valid) => {
    const r = validateConcept({ ...ok, bio: "b".repeat(n) });
    expect(r.ok).toBe(valid);
    if (!r.ok) expect(r.errors.bio).toBeTruthy();
  });
  it("rejects unknown category", () => {
    const r = validateConcept({ ...ok, category: "Nope" });
    expect(r).toMatchObject({ ok: false, errors: { category: expect.any(String) } });
  });
  it("collects all errors", () => {
    const r = validateConcept({ name: "", ticker: "", bio: "b".repeat(300), category: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["bio", "category", "name", "ticker"]);
  });
});

describe("validateImageFile", () => {
  it.each(["image/png", "image/jpeg", "image/webp"])("accepts %s", (type) => {
    expect(validateImageFile({ type, size: 10 })).toEqual({ ok: true });
  });
  it("rejects wrong mime", () => {
    for (const type of ["image/gif", "text/plain", ""]) {
      expect(validateImageFile({ type, size: 10 })).toMatchObject({ ok: false, error: expect.any(String) });
    }
  });
  it.each([[0, false], [1, true], [2097152, true], [2097153, false]])("size %i valid=%s", (size, valid) => {
    expect(validateImageFile({ type: "image/png", size }).ok).toBe(valid);
  });
});
