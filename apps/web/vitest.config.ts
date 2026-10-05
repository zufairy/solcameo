import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's `@/*` → `./*` so route-handler tests can import files
    // that use the app-wide alias.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // edge-runtime most faithfully mirrors the Convex function runtime.
    // Tests that need Node built-ins (e.g. node:crypto) opt out per-file with
    // a `// @vitest-environment node` pragma.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    // Playwright owns e2e/ — vitest must not pick up its .spec.ts files.
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
});
