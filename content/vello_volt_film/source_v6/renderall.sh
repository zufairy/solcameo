#!/bin/bash
cd /home/claude/v6
for v in 1 2 3; do
  N=$(node -e "console.log(1)" >/dev/null; echo 1900)
  node rend.js $v 0 950 > rl_${v}a.log 2>&1 &
  node rend.js $v 950 99999 > rl_${v}b.log 2>&1 &
  wait
done
echo ALLDONE > rl_done.txt
