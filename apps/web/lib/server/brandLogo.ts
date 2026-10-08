import { join } from "node:path";

/** The Solcameo star + wordmark used by every rendered card. */
export const LOGO_FILE = join(process.cwd(), "assets", "solcameo-logo.png");
/** Fraction of the logo's width taken by the star, so the card renderers can split it into mark and wordmark. */
export const LOGO_CUT = 0.177;
