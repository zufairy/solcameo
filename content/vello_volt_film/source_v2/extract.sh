G="eq=contrast=1.2:saturation=0.72:brightness=-0.03,colorbalance=rs=-0.05:gs=0.03:bs=0.03:rh=0.03:gh=0.05:bh=-0.07"
ex(){ id=$1; dur=$2; mkdir -p seq/b$id; ffmpeg -v error -y -t $dur -i src/broll/vvbroll_$id.mp4 -vf "fps=30,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,$G" -q:v 4 seq/b$id/%05d.jpg; echo "b$id $(ls seq/b$id | wc -l)"; }
ex 16605636 10; ex 39904068 12; ex 31196472 9.4; ex 31196475 1.44; ex 16001003 12; ex 3088697 10; ex 9823146 5.3; ex 13866489 6.9; ex 18447536 6.5; ex 18447538 6.5; ex 18447540 3; ex 33637800 8; ex 38581107 8; ex 38440687 8; ex 10825391 8; ex 36062880 6
mkdir -p seq/jd seq/jds
ffmpeg -v error -y -t 42 -i src/jadoodoo1.mp4 -vf "fps=30,eq=contrast=1.08:saturation=1.05" -q:v 3 seq/jd/%05d.jpg
ffmpeg -v error -y -t 42 -i src/jadoodoo1.mp4 -vf "fps=30,scale=640:360" -q:v 5 seq/jds/%05d.jpg
echo jd $(ls seq/jd | wc -l)
ffmpeg -v error -y -i src/jadoodoo1.mp4 -vn -ac 2 -ar 48000 audio/jd_audio.wav
echo DONE
