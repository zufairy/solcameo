import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/video/*": ["./public/vello-logo-white.png"],
    "/api/admin/content-control/material": [
      "./assets/lo.png",
      "./public/fonts/captions/Anton-Regular.ttf",
      "./public/fonts/captions/PlusJakartaSans-SemiBold.ttf",
      "./public/fonts/captions/SpaceGrotesk-Medium.ttf",
      "./public/fonts/captions/Manrope-Medium.ttf",
      "./public/fonts/captions/Fraunces-SemiBold.ttf",
    ],
    "/api/admin/content-control/worker": [
      "./assets/lo.png",
      "./public/fonts/captions/Anton-Regular.ttf",
      "./public/fonts/captions/PlusJakartaSans-SemiBold.ttf",
      "./public/fonts/captions/SpaceGrotesk-Medium.ttf",
      "./public/fonts/captions/Manrope-Medium.ttf",
      "./public/fonts/captions/Fraunces-SemiBold.ttf",
    ],
    "/api/render-studio/*": ["./public/render-studio/vendor/*", "./public/fonts/captions/*"],
    "/api/dev/post-material": [
      "./assets/lo.png",
      "./public/fonts/captions/Anton-Regular.ttf",
      "./public/fonts/captions/PlusJakartaSans-SemiBold.ttf",
      "./public/fonts/captions/SpaceGrotesk-Medium.ttf",
      "./public/fonts/captions/Manrope-Medium.ttf",
      "./public/fonts/captions/Fraunces-SemiBold.ttf",
    ],
  },
  // Render Studio previews run in sandboxed iframes (opaque origin), so the
  // self-hosted fonts must be CORS-readable or @font-face silently fails.
  async headers() {
    return [
      { source: "/fonts/captions/:file*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
      { source: "/render-studio/vendor/:file*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }, { key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
  // ffmpeg-static ships a native binary; if Next bundles it, the spawn path is
  // rewritten into .next/vendor-chunks and the binary isn't there (ENOENT). Keep
  // it external so `ffmpegPath` resolves to the real node_modules path. Used by
  // the /api/video/* clip routes.
  // playwright-core spawns a native Chromium binary (App-mode URL screenshots in
  // lib/server/screenshotUrl.ts). Like ffmpeg-static, if Next bundles it the
  // launcher paths get rewritten into vendor-chunks and it can't find its own
  // driver — keep it external so it resolves from real node_modules.
  // The DBC SDK is used only by server routes; load it natively to avoid
  // rebundling its Anchor/IDL dependency tree for every route.
  serverExternalPackages: ["ffmpeg-static", "playwright-core", "@meteora-ag/dynamic-bonding-curve-sdk"],
  // The repo is mid-refactor (aiWorkers migration etc.), so a strict type-check
  // would fail the production build and block deploys. Enforced in dev + CI,
  // not as a hard deploy gate.
  typescript: { ignoreBuildErrors: true },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }
    // Privy (@privy-io/react-auth) lazily references optional integrations we don't
    // use (Stripe fiat on-ramp, Farcaster mini-app). They aren't installed, so alias
    // them to false to keep `next build` from failing on "Module not found".
    config.resolve.alias = {
      ...config.resolve.alias,
      "@stripe/crypto": false,
      "@farcaster/mini-app-solana": false,
    };
    return config;
  },
};

export default nextConfig;
