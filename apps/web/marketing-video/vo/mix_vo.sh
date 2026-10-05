#!/usr/bin/env bash
# Remix the five promo films with voiceover files (vo/V1.mp3 … vo/V5.mp3).
# Music ducks -10dB under the VO via sidechain compression.
set -e
cd "$(dirname "$0")/.."
declare -A OFFSET=( [V1WhileYouSlept]=0 [V2TheLoop]=8 [V3TheSwarm]=16 [V4TheMath]=4 [V5Manifesto]=12 )
i=1
for c in V1WhileYouSlept V2TheLoop V3TheSwarm V4TheMath V5Manifesto; do
  vo="vo/V${i}.mp3"; off=${OFFSET[$c]}
  if [ -f "$vo" ]; then
    ffmpeg -y -i "out/${c}.silent.mp4" -ss "$off" -t 30 -i "public/audio/swarm.mp3" -i "$vo" -filter_complex \
      "[1:a]afade=t=in:d=1,afade=t=out:st=27:d=3,volume=0.9[m];[2:a]adelay=800|800,volume=1.0[v];[m][v]sidechaincompress=threshold=0.05:ratio=8:attack=40:release=400[duck];[duck][v]amix=inputs=2:duration=first:normalize=0[a]" \
      -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k "out/${c}.mp4"
    echo "✓ ${c}.mp4 (with VO)"
  else
    echo "· $vo missing — skipped $c"
  fi
  i=$((i+1))
done
