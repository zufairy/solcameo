const C0_WHITESPACE = /[\t\n\v\f\r]+/g;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const INVISIBLES = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Collapses whitespace and strips control, zero-width and bidi characters. Shared by chat and character creation. */
export function normalizeText(raw: string): string {
  return raw.replace(C0_WHITESPACE, " ").replace(CONTROL_CHARS, "").replace(INVISIBLES, "").replace(/\s+/g, " ").trim();
}
