// Side-effect import: load .env.local BEFORE any lib module reads process.env at
// module scope (e.g. lib/server/nftKie.ts captures KIE_API_KEY on import). ESM
// evaluates imports in source order, so this must be the FIRST import of a script.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
