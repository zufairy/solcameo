import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const APP = "https://velloagents.com";
const bal = async (w, label) => { try { const b = await (await fetch(`${APP}/api/agent-wallet-balance?wallet=${w}`)).json(); console.log(`${label.padEnd(20)} ${w.slice(0,8)}  USDC=${b.ok ? "$" + Number(b.usdc).toFixed(2) : "err:" + b.error}`); } catch (e) { console.log(`${label} fetch-err`); } };
await bal(get("NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET"), "TREASURY");
await bal("7wCGaUEt83nGgiYftNHqSB18Evjh3Ah8aayYCpU3KNQu", "Bamboms wallet");
