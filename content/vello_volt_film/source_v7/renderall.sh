#!/bin/bash
cd /home/claude/v7
for v in 4 5 6 7 8; do
  node rend.js $v 0 1120 > rl_${v}a.log 2>&1 &
  node rend.js $v 1120 99999 > rl_${v}b.log 2>&1 &
  wait
done
echo ALLDONE > rl_done.txt
