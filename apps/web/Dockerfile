FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY scripts ./scripts
# --legacy-peer-deps: Privy (@privy-io/react-auth) pulls peerOptional
# permissionless/ox that otherwise ERESOLVE-fail `npm ci`. The lockfile is
# generated the same way, so this resolves cleanly. NOTE: npm ci must NOT be
# masked by `|| true` (that hid the failure and left node_modules missing, which
# is what broke `COPY --from=deps /app/node_modules`); only the optional native
# rebuild is allowed to fail.
RUN npm ci --legacy-peer-deps && (npm rebuild bigint-buffer --build-from-source || true)

# ── YouTube PO-token provider (free replacement for the residential proxy) ──
# yt-dlp on a datacenter IP is bot-walled unless each request carries a BotGuard
# "Proof of Origin" token. bgutil-ytdlp-pot-provider mints them: a small Node
# server (built here, run alongside the app by scripts/start.sh on :4416) plus a
# yt-dlp plugin zip that asks that server for a token per download. Both are
# BEST-EFFORT: if either download fails the image still builds and the
# downloader simply runs without POT (proxy fallback still applies).
ARG BGUTIL_REF=master
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/* \
  && ( git clone --depth 1 --branch "$BGUTIL_REF" https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil \
       && cd /opt/bgutil/server && npm ci && npx tsc \
       && test -f /opt/bgutil/server/build/main.js \
       && echo "[build] bgutil POT server built" \
       || (echo "[build] bgutil POT server build FAILED — continuing without POT" && rm -rf /opt/bgutil && mkdir -p /opt/bgutil) ) \
  && mkdir -p /app/bin/yt-dlp-plugins \
  && ( curl -fsSL -o /app/bin/yt-dlp-plugins/bgutil-ytdlp-pot-provider.zip \
         https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip \
       && echo "[build] bgutil yt-dlp plugin zip downloaded" \
       || echo "[build] bgutil plugin zip download FAILED — continuing without POT" )

# ── Cloudflare WARP egress (FREE fix for YouTube's datacenter-IP bot wall) ──
# YouTube walls cloud IP ranges; WARP exits are Cloudflare consumer IPs it
# doesn't. wgcf registers a free WARP identity, wireproxy (userspace WireGuard —
# no root/TUN, works in a plain container) exposes it as a local proxy. Started
# by scripts/start.sh via scripts/warp.sh. Pinned + BEST-EFFORT: a failed
# download just leaves the image without the WARP route.
ARG WGCF_VERSION=2.3.0
ARG WIREPROXY_VERSION=1.1.3
RUN ( curl -fsSL -o /app/bin/wgcf "https://github.com/ViRb3/wgcf/releases/download/v${WGCF_VERSION}/wgcf_${WGCF_VERSION}_linux_amd64" \
       && chmod +x /app/bin/wgcf && echo "[build] wgcf downloaded" \
       || (echo "[build] wgcf download FAILED — continuing without WARP" && rm -f /app/bin/wgcf) ) \
  && ( curl -fsSL "https://github.com/windtf/wireproxy/releases/download/v${WIREPROXY_VERSION}/wireproxy_linux_amd64.tar.gz" | tar -xz -C /app/bin wireproxy \
       && chmod +x /app/bin/wireproxy && echo "[build] wireproxy downloaded" \
       || (echo "[build] wireproxy download FAILED — continuing without WARP" && rm -f /app/bin/wireproxy) )

FROM base AS builder
# NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, so they
# must be present during `next build` — not just at runtime. Railway injects its
# service variables as build args automatically; declaring them as ARG here lets
# `next build` see them. Missing → blank values baked into the bundle (e.g. the
# "Missing NEXT_PUBLIC_CONVEX_URL" banner and dead Convex queries in prod).
ARG NEXT_PUBLIC_CONVEX_URL
ARG NEXT_PUBLIC_CONVEX_SITE_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_HELIUS_API_KEY
ARG NEXT_PUBLIC_SOLANA_NETWORK
ARG NEXT_PUBLIC_SOLANA_RPC_URL
ARG NEXT_PUBLIC_USDC_MINT
ARG NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET
ARG NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID
ARG NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID
ARG NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL \
    NEXT_PUBLIC_CONVEX_SITE_URL=$NEXT_PUBLIC_CONVEX_SITE_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_HELIUS_API_KEY=$NEXT_PUBLIC_HELIUS_API_KEY \
    NEXT_PUBLIC_SOLANA_NETWORK=$NEXT_PUBLIC_SOLANA_NETWORK \
    NEXT_PUBLIC_SOLANA_RPC_URL=$NEXT_PUBLIC_SOLANA_RPC_URL \
    NEXT_PUBLIC_USDC_MINT=$NEXT_PUBLIC_USDC_MINT \
    NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET=$NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET \
    NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID=$NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID \
    NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID=$NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID \
    NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# yt-dlp: social-URL ingestion (YouTube/TikTok/…) shells out to a standalone
# yt-dlp binary (lib/server/downloader.ts). REUSE the binary the deps stage
# already downloaded in its postinstall instead of re-fetching it here — the old
# `RUN install && test -x` re-downloaded from GitHub a second time, and a transient
# ETIMEDOUT then failed the whole build even though deps had the binary. The
# postinstall always `mkdir`s bin/ first, so /app/bin exists in deps even if the
# download was skipped → this COPY can't fail. yt-dlp is optional (social URLs
# only, with a runtime install fallback), so a rare empty bin/ just defers install
# to first use rather than breaking the deploy.
COPY --from=deps /app/bin ./bin
ENV YTDLP_PATH=/app/bin/yt-dlp
# PO-token provider server (built in deps) + the yt-dlp plugin that talks to
# it (already inside bin/yt-dlp-plugins from the COPY above). scripts/start.sh
# boots the server on :4416 before the app; the downloader reads these two
# envs. YTDLP_DIRECT_FIRST=0 restores proxy-on-every-attempt if ever needed.
COPY --from=deps /opt/bgutil /opt/bgutil
COPY scripts/start.sh ./scripts/start.sh
COPY scripts/warp.sh ./scripts/warp.sh
RUN chmod +x ./scripts/start.sh ./scripts/warp.sh
ENV YTDLP_POT_PROVIDER_URL=http://127.0.0.1:4416 \
    YTDLP_PLUGIN_DIRS=/app/bin/yt-dlp-plugins \
    YTDLP_JS_RUNTIME=node \
    BGUTIL_SERVER_DIR=/opt/bgutil/server

# ffmpeg: the npm ffmpeg-static linux-x64 binary (b6.1.1 → johnvansickle 7.0.2
# build) is compiled without libharfbuzz, and ffmpeg >= 6.1 made harfbuzz a hard
# dependency of the drawtext filter — so that binary has NO drawtext and every
# title_card / text_overlay render fails with "No such filter: 'drawtext'".
# Install the distro ffmpeg (full filter set) plus DejaVu fonts (the slim image
# ships none; resolveFontFile in app/api/video/clip/route.ts looks for
# /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf, and libass needs a real
# font for caption burn-in). FFMPEG_BIN is the override ffmpeg-static itself
# honors, so every call site picks this binary up with no code changes. Verify
# drawtext at build time so a regression fails the image, not a user's render.
# fonts-noto-* give libass/fontconfig real glyphs for non-latin captions (CJK,
# Korean, Arabic, Devanagari, Thai) — lib/server/captionRenderer.fontForText()
# selects these families by script; without them non-latin captions tofu.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fontconfig \
       fonts-noto-cjk fonts-noto-core \
  && rm -rf /var/lib/apt/lists/* \
  && ffmpeg -hide_banner -filters 2>/dev/null | grep -q drawtext
ENV FFMPEG_BIN=/usr/bin/ffmpeg

# Chromium: App-mode reference capture (lib/server/screenshotUrl.ts) drives a
# headless Chromium via playwright-core to screenshot the product/app URL. Install
# the distro Chromium + its shared libraries (the slim image ships none of them),
# and point playwright-core at it with PLAYWRIGHT_CHROMIUM_PATH.
#
# We verify the BINARY is installed (`test -x`) so a broken apt install still fails
# the image. We do NOT hard-fail on a launch smoke-test: Chromium reliably SIGTRAPs
# ("Trace/breakpoint trap") inside the BuildKit build sandbox — which lacks the
# namespaces/seccomp + /proc bits it wants — even though it launches fine at RUNTIME
# with --no-sandbox. So the launch is best-effort (|| echo) and its noise is
# swallowed (2>&1, DBUS_SESSION_BUS_ADDRESS=/dev/null); Chromium is best-effort at
# runtime anyway (App mode falls back to URL scraping).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       chromium libnss3 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 \
       libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
       libasound2 libpango-1.0-0 libcairo2 \
  && rm -rf /var/lib/apt/lists/* \
  && test -x /usr/bin/chromium \
  && (DBUS_SESSION_BUS_ADDRESS=/dev/null chromium --headless=new --no-sandbox \
        --disable-gpu --disable-dev-shm-usage --no-zygote --disable-crashpad \
        --dump-dom 'data:text/html,<h1>ok</h1>' >/dev/null 2>&1 \
      && echo "[build] chromium launch smoke-test ok" \
      || echo "[build] chromium launch smoke-test skipped — SIGTRAPs in the build sandbox but runs at runtime with --no-sandbox")
ENV PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# playwright-core: Next's standalone tracing only copies the statically-reachable
# entry files (~8 of them) and drops lib/server/chromium — the driver launch()
# needs — because playwright loads it dynamically. Without the full package
# chromium.launch() throws and App-mode screenshots silently degrade to URL
# scraping. Overlay the COMPLETE package from deps (it's dependency-free / self-
# bundled, so this dir alone is sufficient), same pattern as bin/ and ffmpeg above.
COPY --from=deps /app/node_modules/playwright-core ./node_modules/playwright-core

# JEV lab (/dev/jev → app/api/dev/jev): the Jev judge is Typesafe's Python-only
# SDK, run as a sidecar (scripts/jev/jev_score.py, spawned per search). The
# standalone output does not trace a .py file, so copy it in explicitly. Debian
# bookworm's python3 is 3.11 (SDK needs >=3.10) and its pip is "externally
# managed", hence a venv. Verified at build time so a broken install fails the
# image, not a search. Needs TYPESAFE_API_KEY at runtime; without it the lab
# falls back to keyword ranking instead of failing.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/jev-venv \
  && /opt/jev-venv/bin/pip install --no-cache-dir -q "typesafe-sdk>=0.7,<0.8" \
  && /opt/jev-venv/bin/python -c "from typesafe_sdk import Noul, TypeSafeClient"
ENV JEV_PYTHON=/opt/jev-venv/bin/python
COPY scripts/jev ./scripts/jev

EXPOSE 3000

CMD ["./scripts/start.sh"]
