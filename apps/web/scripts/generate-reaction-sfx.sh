#!/usr/bin/env bash
# Synthesize the Reaction SFX pack (original, royalty-free stings) into $1.
# Voice stings (bruh/fah) use macOS `say`. Upload with scripts/upload-reaction-sfx-to-r2.ts.
set -e
OUT="${1:?usage: generate-reaction-sfx.sh <outDir>}"
FF="${FFMPEG:-$(node -p "require(\"ffmpeg-static\")")}"
D="$(mktemp -d)"; mkdir -p "$OUT"; cd "$D"
enc="-ac 2 -ar 44100 -c:a libmp3lame -b:a 192k"
q="-hide_banner -loglevel error -y"
"$FF" $q -f lavfi -i "aevalsrc='0.9*sin(2*PI*(95*t-38*t*t))*exp(-2.6*t)+0.35*sin(2*PI*(190*t-76*t*t))*exp(-5*t)+0.5*(random(0)-0.5)*exp(-60*t)':s=44100:d=1.4" -af "volume=2.2,asoftclip=type=tanh,aecho=0.6:0.4:60:0.25,alimiter=limit=0.95" $enc vine-boom.mp3
say -v Fred -r 120 -o bruh.aiff "bruh"; "$FF" $q -i bruh.aiff -af "asetrate=22050*0.82,aresample=44100,volume=2.5,aecho=0.7:0.5:40:0.2,alimiter=limit=0.95" $enc bruh.mp3
say -v Ralph -r 110 -o fah.aiff "faaah!"; "$FF" $q -i fah.aiff -af "asetrate=22050*0.9,aresample=44100,volume=2.5,aecho=0.8:0.6:90:0.3,alimiter=limit=0.95" $enc fah.mp3
"$FF" $q -f lavfi -i "aevalsrc='if(lt(t,1.2),0.5*sin(2*PI*(200*t+500*t*t))*(t/1.2)+0.25*(random(0)-0.5)*(t/1.2),0.9*sin(2*PI*(70*(t-1.2)-20*(t-1.2)^2))*exp(-3*(t-1.2))+0.5*(random(0)-0.5)*exp(-25*(t-1.2)))':s=44100:d=2.2" -af "volume=1.8,asoftclip=type=tanh,aecho=0.6:0.4:80:0.3,alimiter=limit=0.95" $enc riser-hit.mp3
"$FF" $q -f lavfi -i "aevalsrc='(0.6*(random(0)-0.5)+0.5*sin(2*PI*(400+350*sin(2*PI*5*t))*t))*(sin(PI*t/0.45)^2)*lt(t,0.45)':s=44100:d=0.55" -af "bandpass=f=1800:width_type=q:w=0.8,volume=4,alimiter=limit=0.95" $enc record-scratch.mp3
"$FF" $q -f lavfi -i "aevalsrc='if(lt(t,0.7),(random(0)-0.5)*sin(PI*t/0.7)^2,0.9*sin(2*PI*(80*(t-0.7)))*exp(-6*(t-0.7))+0.6*(random(0)-0.5)*exp(-30*(t-0.7)))':s=44100:d=1.5" -af "highpass=f=120,volume=2.2,asoftclip=type=tanh,alimiter=limit=0.95" $enc whoosh-impact.mp3
"$FF" $q -f lavfi -i "aevalsrc='0.7*sin(2*PI*(220*t+(40/(2*PI*9))*sin(2*PI*9*t)*6))*exp(-2.2*t)':s=44100:d=1.1" -af "volume=1.6,alimiter=limit=0.95" $enc cartoon-boing.mp3
"$FF" $q -f lavfi -i "aevalsrc='0.5*sin(2*PI*(if(lt(t,0.6),500*t+700*t*t,500*0.6+700*0.36+1340*(t-0.6)-900*(t-0.6)^2)))*(1+0.05*sin(2*PI*6*t))*min(1,8*t)*min(1,5*(1.2-t))':s=44100:d=1.2" -af "volume=1.4,alimiter=limit=0.95" $enc slide-whistle.mp3
"$FF" $q -f lavfi -i "aevalsrc='if(lt(t,0.18),0.3*(sin(2*PI*392*t)+0.5*sin(2*PI*784*t)+0.3*sin(2*PI*1176*t))*min(1,40*t),0.22*(sin(2*PI*523.25*t)+sin(2*PI*659.25*t)+sin(2*PI*783.99*t)+0.4*sin(2*PI*1046.5*t)+0.2*sin(2*PI*1569*t))*min(1,40*(t-0.18))*exp(-1.4*(t-0.18)))':s=44100:d=1.5" -af "aecho=0.6:0.4:50:0.25,volume=1.4,alimiter=limit=0.95" $enc cartoon-tada.mp3
rm -f *.aiff; ls -la
for f in *.mp3; do "$FF" -hide_banner -loglevel error -y -i "$f" -af "loudnorm=I=-14:TP=-1:LRA=11,aresample=44100" -ac 2 -c:a libmp3lame -b:a 192k "$OUT/$f"; done
echo "wrote $(ls "$OUT" | wc -l) files to $OUT"
