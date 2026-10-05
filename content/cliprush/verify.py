import os,subprocess,json
from PIL import Image,ImageDraw
base=os.path.abspath('apps/web/marketing-video/node_modules/@remotion/compositor-darwin-arm64');os.environ['DYLD_LIBRARY_PATH']=base
file='content/Vello_ClipRush_1080p60.mp4'
probe=json.loads(subprocess.check_output([base+'/ffprobe','-v','error','-show_streams','-show_format','-of','json',file]))
print(json.dumps({'duration':probe['format']['duration'],'streams':[{k:s.get(k) for k in ['codec_name','width','height','r_frame_rate','sample_rate','channels']} for s in probe['streams']]},indent=2))
times=[.3,1,2,3.5,5,8.5,10,12,13.5,15,16.5,18.5,20.5,22.5,25,27.5,29,31]
sheet=Image.new('RGB',(1280,((len(times)+3)//4)*202));d=ImageDraw.Draw(sheet)
for i,t in enumerate(times):
 p=f'/tmp/cliprush-final-{i}.jpg'
 subprocess.run([base+'/ffmpeg','-y','-ss',str(t),'-i',file,'-frames:v','1','-vf','scale=320:180',p],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
 sheet.paste(Image.open(p),(i%4*320,i//4*202));d.text((i%4*320+8,i//4*202+183),str(t)+'s',fill='white')
sheet.save('content/cliprush/final-contact.jpg')
