#!/bin/bash
cd /home/claude/v7
declare -A N=( [4]=VELLO_V7_4_METAMORPHOSIS [5]=VELLO_V7_5_BEST_OF_THE_BEST [6]=VELLO_V7_6_NEVER [7]=VELLO_V7_7_FREEDOM [8]=VELLO_V7_8_HOW_IT_WORKS )
for v in 4 5 6 7 8; do
  ffmpeg -y -v error -framerate 30 -i frames$v/%05d.jpg -i mix$v.wav -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 256k -shortest ${N[$v]}.mp4
  ffmpeg -y -v error -i ${N[$v]}.mp4 -c:v libx264 -preset medium -b:v 3.2M -maxrate 4M -bufsize 8M -c:a aac -b:a 192k -movflags +faststart /mnt/user-data/outputs/${N[$v]}_preview.mp4
  echo done $v >> enc8.log
done
echo ALL >> enc8.log
