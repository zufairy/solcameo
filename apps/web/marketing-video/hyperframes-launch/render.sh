#!/bin/sh
set -eu
cd "$(dirname "$0")"
export HYPERFRAMES_NO_TELEMETRY=1
export HYPERFRAMES_NO_UPDATE_CHECK=1
export HYPERFRAMES_FFMPEG_PATH="$(cd ../../../.. && pwd)/node_modules/ffmpeg-static/ffmpeg"
export HYPERFRAMES_FFPROBE_PATH="$PWD/node_modules/ffprobe-static/bin/darwin/arm64/ffprobe"
node_modules/.bin/hyperframes render . --output ../out/solcameo-launch-hyperframes/solcameo-main-character-16x9.mp4 --fps 30 --quality high --workers 2
