import sys, subprocess, time
from scenes import *
a, b, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
p = subprocess.Popen(['ffmpeg','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
    '-c:v','libx264','-preset','medium','-crf','15','-pix_fmt','yuv420p',out], stdin=subprocess.PIPE)
t0=time.time()
for i in range(a, b):
    p.stdin.write(frame(i / FPS).tobytes())
    if i % 60 == 0: print(out, i, f'{time.time()-t0:.0f}s', flush=True)
p.stdin.close(); p.wait(); print('done', out, flush=True)
