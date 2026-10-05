import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load .env.local so the dev-only E2E_AUTH_BYPASS_SECRET is visible to e2e/audit/auth.ts
// when arming an authenticated-bypass session. These vars are DEV ONLY — never set in prod/CI.
loadEnv({ path: ".env.local" });

/**
 * E2E for the clipping canvas. Tests are functional-only (no pipeline runs, no
 * API spend). `webServer` reuses a dev server if one is already running
 * (local dev), otherwise starts one (CI).
 */
export default defineConfig({
  testDir: "./e2e",
  // 120s: CI's cold webpack compile of /builder can eat 60s on the FIRST
  // navigation alone (observed in Actions) — tests then time out before the
  // page even renders. Local runs are unaffected (compile is warm).
  timeout: 120_000,
  fullyParallel: false, // shared dev server + localStorage state
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
