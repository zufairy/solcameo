import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const s = get("PLATFORM_FEE_PAYER_SECRET");
console.log("present:", !!s, "| raw char length:", s.length);
console.log("first 6:", JSON.stringify(s.slice(0, 6)), " last 4:", JSON.stringify(s.slice(-4)));
try { console.log("as base64 -> bytes:", Buffer.from(s, "base64").length, "  (Solana keypair = 64)"); } catch { console.log("base64 decode: FAIL"); }
try { const a = JSON.parse(s); console.log("as JSON: array =", Array.isArray(a), "len =", Array.isArray(a) ? a.length : "-", "  (solana-keygen id.json = 64-number array)"); } catch { console.log("as JSON: not JSON"); }
try { const bs58 = (await import("bs58")).default; console.log("as base58 -> bytes:", bs58.decode(s).length, "  (Phantom export = 64)"); } catch (e) { console.log("as base58: FAIL (" + String(e.message).slice(0, 30) + ")"); }
