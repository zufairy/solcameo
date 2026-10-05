#!/bin/sh
# Container entrypoint: boot the YouTube PO-token provider (bgutil) next to the
# app, then run the Next.js standalone server as PID 1's child.
#
# The provider is BEST-EFFORT. If its build was skipped in the image (see the
# Dockerfile deps stage) or it fails to start, the app still comes up and the
# downloader falls back to the residential proxy path for walled videos.
set -eu

BGUTIL_SERVER_DIR="${BGUTIL_SERVER_DIR:-/opt/bgutil/server}"
BGUTIL_PORT="${BGUTIL_PORT:-4416}"

if [ -f "$BGUTIL_SERVER_DIR/build/main.js" ]; then
  echo "[start] launching bgutil POT provider on :$BGUTIL_PORT"
  ( cd "$BGUTIL_SERVER_DIR" && exec node build/main.js --port "$BGUTIL_PORT" ) &
  BGUTIL_PID=$!
  # Give it a moment; log whether /ping answers so a dead provider is visible in
  # deploy logs instead of only as slower downloads.
  (
  i=0
  while [ $i -lt 20 ]; do
    if node -e "fetch('http://127.0.0.1:$BGUTIL_PORT/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      echo "[start] bgutil POT provider ready"
      break
    fi
    i=$((i+1)); sleep 0.5
  done
  [ $i -ge 20 ] && echo "[start] bgutil POT provider did not answer /ping in 10s (pid $BGUTIL_PID) — continuing; downloads fall back to proxy"
  ) &
else
  echo "[start] bgutil POT provider not present in image — downloads use cookies/proxy only"
fi

# Cloudflare WARP egress (free fix for YouTube's datacenter-IP bot wall — see
# scripts/warp.sh). Best-effort: without the binaries or a WARP identity the
# downloader simply skips its WARP attempts. YTDLP_WARP=0 disables it.
WGCF_BIN="${WGCF_BIN:-/app/bin/wgcf}"
WIREPROXY_BIN="${WIREPROXY_BIN:-/app/bin/wireproxy}"
WARP_DIR="${WARP_DIR:-/tmp/warp}"
WARP_HTTP_PORT="${WARP_HTTP_PORT:-25345}"
if [ "${YTDLP_WARP:-1}" != "0" ] && [ -x "$WGCF_BIN" ] && [ -x "$WIREPROXY_BIN" ]; then
  export WARP_DIR WGCF_BIN WARP_HTTP_PORT
  export YTDLP_WARP_PROXY="http://127.0.0.1:$WARP_HTTP_PORT"
  export WARP_SCRIPT="$(cd "$(dirname "$0")" && pwd)/warp.sh"
  (
  if sh "$(dirname "$0")/warp.sh" setup; then
    # Supervisor: restart wireproxy if it dies — or when warp.sh rotate kills it
    # to switch to a fresh identity. Its pid is kept for that rotate.
    (
      while true; do
        "$WIREPROXY_BIN" -c "$WARP_DIR/wireproxy.conf" >/dev/null 2>&1 &
        echo $! > "$WARP_DIR/wireproxy.pid"
        wait $! || true
        sleep 1
      done
    ) &
    export YTDLP_WARP_PROXY="http://127.0.0.1:$WARP_HTTP_PORT"
    export WARP_SCRIPT="$(cd "$(dirname "$0")" && pwd)/warp.sh"
    echo "[start] WARP egress on $YTDLP_WARP_PROXY"
  else
    echo "[start] WARP registration failed — downloads skip the WARP route"
  fi
  ) &
else
  echo "[start] WARP egress not available (binaries missing or YTDLP_WARP=0)"
fi

exec node server.js
