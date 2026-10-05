import os, subprocess, glob
from PIL import Image,ImageDraw
base='apps/web/marketing-video'
os.environ['DYLD_LIBRARY_PATH']=os.path.abspath(base+'/node_modules/@remotion/compositor-darwin-arm64')
ff=base+'/node_modules/@remotion/compositor-darwin-arm64/ffmpeg'
files=glob.glob(base+'/public/stock/*.mp4')+glob.glob(base+'/public/doc/*.mp4')
sheet=Image.new('RGB',(1000, ((len(files)+3)//4)*160))
d=ImageDraw.Draw(sheet)
for i,f in enumerate(files):
 out=f'/tmp/cliprush-{i}.jpg'
 subprocess.run([ff,'-y','-ss','1','-i',f,'-frames:v','1','-vf','scale=240:135',out],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 if os.path.exists(out): sheet.paste(Image.open(out),(i%4*250,i//4*160))
 d.text((i%4*250,i//4*160+137),os.path.basename(f),fill='white')
sheet.save('content/cliprush/assets.jpg')
