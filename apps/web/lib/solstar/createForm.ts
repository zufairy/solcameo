import { normalizeText } from "./text";

export const CATEGORIES = ["Comedy", "Culture", "Music", "Gaming", "Food", "Fashion", "Tech", "Other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const NAME_MIN = 2;
export const NAME_MAX = 32;
export const TICKER_MIN = 2;
export const TICKER_MAX = 10;
export const BIO_MAX = 280;
export const IMAGE_MAX_BYTES = 2_097_152;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const TICKER_PATTERN = /^[A-Z0-9]{2,10}$/;
export const IDEMPOTENCY_KEY_MIN = 8;
export const IDEMPOTENCY_KEY_MAX = 128;

export function isCategory(v: string): v is Category {
  return (CATEGORIES as readonly string[]).includes(v);
}

/** Uppercase, strip everything but A-Z0-9, cap at 10 characters. */
export function normalizeTicker(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, TICKER_MAX);
}

export type ConceptField = "name" | "ticker" | "bio" | "category";
export type ConceptResult = { ok: true } | { ok: false; errors: Partial<Record<ConceptField, string>> };

export function validateConcept(input: { name: string; ticker: string; bio: string; category: string }): ConceptResult {
  const errors: Partial<Record<ConceptField, string>> = {};
  const name = normalizeText(input.name);
  if (name.length < NAME_MIN || name.length > NAME_MAX) errors.name = `Name must be ${NAME_MIN}-${NAME_MAX} characters.`;
  if (!TICKER_PATTERN.test(input.ticker)) errors.ticker = `Ticker must be ${TICKER_MIN}-${TICKER_MAX} capital letters or digits.`;
  if (normalizeText(input.bio).length > BIO_MAX) errors.bio = `Description can be at most ${BIO_MAX} characters.`;
  if (!isCategory(input.category)) errors.category = "Choose a category.";
  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors };
}

export type ImageResult = { ok: true } | { ok: false; error: string };

export function validateImageFile(file: { type: string; size: number }): ImageResult {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return { ok: false, error: "Use a PNG, JPG or WebP image." };
  if (file.size <= 0) return { ok: false, error: "That file is empty." };
  if (file.size > IMAGE_MAX_BYTES) return { ok: false, error: "Image must be 2 MB or smaller." };
  return { ok: true };
}
