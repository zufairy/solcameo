#!/usr/bin/env node
// INSERT diagnostic for the content-reward auto-submission failure. Reproduces the
// EXACT users-insert that ensureJobtepiUserId does, via the SAME client the code
// builds (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), and prints the FULL
// structured Postgres error (message/code/details/hint) that prod hides behind an
// empty message. Inserts ONE clearly-tagged diagnostic row and cleans it up (incl.
// the community rows the AFTER-INSERT triggers create) on success.
//
// Run from apps/web (auto-loads .env.local):  node scripts/diag-content-reward-submit.mjs

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}

// EXACTLY what lib/server/contentRewardSubmit.ts reads:
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SB_URL || !SB_KEY) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local"); process.exit(1); }

const host = (() => { try { return new URL(SB_URL).host; } catch { return SB_URL; } })();
let ref = "?"; try { ref = JSON.parse(Buffer.from(SB_KEY.split(".")[1], "base64").toString("utf8")).ref ?? "?"; } catch {}
console.log("=== content-reward users-insert repro (WRITE — inserts+deletes one row) ===");
console.log("URL host:", host, "| key project ref:", ref);

const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const showErr = (label, e) => console.log(`${label}:`, e ? JSON.stringify({ message: e.message, code: e.code, details: e.details, hint: e.hint }, null, 2) : "ok");

// The EXACT row shape from ensureJobtepiUserId (diagnostic wallet so it's obvious).
const wallet = `DIAGINSERT${randomUUID().replace(/-/g, "").slice(0, 32)}`;
const id = randomUUID();
const row = {
  id,
  username: `vello_${wallet.slice(0, 8).toLowerCase()}`,
  name: "Vello Diag (delete me)",
  email: `${wallet}@wallet.vello.gg`,
  avatar_url: "https://example.com/a.png",
  profile_image: "https://example.com/a.png",
};

// Step 1a mirror: the binding read (ensureJobtepiUserId does this first).
const rd = await supabase.from("wallet_auth_bindings").select("user_id").eq("wallet_address", wallet).maybeSingle();
showErr("\n[read] wallet_auth_bindings", rd.error);

console.log("\n[insert] users …");
const ins = await supabase.from("users").insert([row]).select("id").single();
if (ins.error) {
  console.log("\n❌ THE REAL ERROR (what prod hides behind an empty message):");
  showErr("users insert", ins.error);
  console.log("\nDecode: 42501=permission/RLS · PGRST301 / JWSError / 401 = JWT-or-project-mismatch · 23505=unique · 23502=not-null · 23503=fk · 42P01=table missing (wrong project)");
  console.log("→ These .env.local (Railway) creds REPRODUCE the prod failure. The error above IS the root cause.");
} else {
  console.log("\n✅ INSERT SUCCEEDED with these creds — id:", ins.data.id, "— cleaning up…");
  // AFTER-INSERT triggers create child rows (auto_join → community_members + community_product_subscriptions).
  showErr("cleanup community_product_subscriptions", (await supabase.from("community_product_subscriptions").delete().eq("user_id", id)).error);
  showErr("cleanup community_members", (await supabase.from("community_members").delete().eq("user_id", id)).error);
  showErr("cleanup users", (await supabase.from("users").delete().eq("id", id)).error);
  console.log("\n→ The insert WORKS with the Railway creds, but prod FAILS → the DEPLOYED build baked a DIFFERENT NEXT_PUBLIC_SUPABASE_URL than runtime. Fix = align NEXT_PUBLIC_SUPABASE_URL + rebuild.");
}
console.log("\nDone.");
