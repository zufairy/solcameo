#!/bin/sh
# Cloudflare WARP egress for yt-dlp — the FREE fix for YouTube's datacenter-IP
# bot wall. YouTube scores cloud ranges (Railway, AWS, …) as bots, but WARP exits
# are Cloudflare consumer IPs it doesn't wall. wgcf registers a free WARP
# identity; wireproxy (userspace WireGuard — no root / TUN needed) exposes it as a
# local proxy the downloader routes whole yt-dlp pulls through (googlevideo URLs
# are IP-bound, so the media must come through the same exit as the extraction).
#
#   warp.sh setup   — register (if no identity yet) + write wireproxy.conf
#   warp.sh rotate  — fresh identity (new exit IP) + restart wireproxy; used by
#                     lib/server/downloader.ts when YouTube starts walling the
#                     current WARP exit. start.sh's loop restarts wireproxy.
#
# Env: WARP_DIR (default /tmp/warp), WGCF_BIN, WIREPROXY_BIN,
#      WARP_SOCKS_PORT (25344), WARP_HTTP_PORT (25345).
set -eu

WARP_DIR="${WARP_DIR:-/tmp/warp}"
WGCF_BIN="${WGCF_BIN:-/app/bin/wgcf}"
WARP_SOCKS_PORT="${WARP_SOCKS_PORT:-25344}"
WARP_HTTP_PORT="${WARP_HTTP_PORT:-25345}"

mkdir -p "$WARP_DIR"
cd "$WARP_DIR"

write_conf() {
  "$WGCF_BIN" generate >/dev/null 2>&1
  {
    cat wgcf-profile.conf
    printf '\n[Socks5]\nBindAddress = 127.0.0.1:%s\n\n[http]\nBindAddress = 127.0.0.1:%s\n' "$WARP_SOCKS_PORT" "$WARP_HTTP_PORT"
  } > wireproxy.conf.tmp
  mv wireproxy.conf.tmp wireproxy.conf
}

case "${1:-setup}" in
  setup)
    if [ ! -f wgcf-account.toml ]; then
      "$WGCF_BIN" register --accept-tos >/dev/null 2>&1
    fi
    write_conf
    echo "[warp] identity ready ($WARP_DIR)"
    ;;
  rotate)
    rm -f wgcf-account.toml wgcf-profile.conf
    "$WGCF_BIN" register --accept-tos >/dev/null 2>&1
    write_conf
    # start.sh's supervisor loop writes wireproxy's pid here and brings it back
    # up on the new identity once killed (pkill isn't in the slim image).
    if [ -f wireproxy.pid ]; then kill "$(cat wireproxy.pid)" 2>/dev/null || true; fi
    echo "[warp] rotated to a fresh identity"
    ;;
  *)
    echo "usage: warp.sh setup|rotate" >&2
    exit 2
    ;;
esac
