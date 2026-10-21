import cv2, numpy as np, json, os
from PIL import Image
PX=14.0; W,H=1540,2002; XC,YB=772.1,1996.4
OUT='/home/claude/fh-showroom/konfig/b2050/'; os.makedirs(OUT,exist_ok=True)
TJ='/home/claude/fh-showroom/konfig/okt50/'; RN='/home/claude/fh-showroom/konfig/rnd50/'
BW=47*PX
bare=cv2.imread('8ecfef11-image.png')
sx=BW/542.0                      # bare image px -> canvas
NECK_H=(268-183)*sx              # isotropic neck
BH=100*PX-NECK_H                 # body height to real total 102 mm
SH=YB-BH
def place(c,img,x,y):
    h,w=img.shape[:2];c[y:y+h,x:x+w]=np.minimum(c[y:y+h,x:x+w],img)
def base(src,sh,bot):
    im=cv2.imread(src);g=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY)<236
    xs=np.where(g[(sh+bot)//2])[0];x0,x1=xs.min(),xs.max();pad=25
    body=cv2.resize(im[sh:bot+3,x0-pad:x1+pad],(int(round((x1-x0+2*pad)*BW/(x1-x0))),int(round((bot-sh+3)*BH/(bot-sh)))),interpolation=cv2.INTER_LANCZOS4)
    c=np.full((H,W,3),255,np.uint8)
    place(c,body[:H-int(round(SH))],int(round(XC-body.shape[1]/2)),int(round(SH)))
    cx=(273+815)/2
    neck=cv2.resize(bare[179:271,int(cx-110):int(cx+110)],(int(round(220*sx)),int(round(92*sx))),interpolation=cv2.INTER_LANCZOS4)
    place(c,neck,int(round(XC-neck.shape[1]/2)),int(round(SH-(268-179)*sx)))
    return c
for n,(f,a,b) in {'leer':('8ecfef11-image.png',268,1306),'tube':('e0b42a69-image.png',348,1319)}.items():
    Image.fromarray(cv2.cvtColor(base(f,a,b),cv2.COLOR_BGR2RGB)).save(OUT+'b2050-base-'+n+'.webp',quality=90)
a=np.array(Image.open(OUT+'b2050-base-tube.webp').convert('L'))<236
for y in range(int(SH)-200,int(SH)+80):
    xs=np.where(a[y])[0]
    if len(xs) and xs.max()-xs.min()>0.6*BW: edge=y;break
print('SH',SH,'edge',edge,'neck mm',NECK_H/PX)
meta={'shoulder':edge}
def head(src,k,out):
    L=Image.open(src).convert('RGBA');L=L.resize((round(L.width*k),round(L.height*k)),Image.LANCZOS)
    al=np.array(L)[...,3];rb=np.where(al.max(1)>128)[0].max()
    L.save(OUT+out+'.webp',quality=92);meta[out]=[int(round(XC-L.width/2)),int(edge+3-rb)]
for nm in ['spr-fea15-gold-o','spr-fea15-silber-o','spr-fea15-schwarz-o','kappe-zylinder-weiss-gold','kappe-polo-weiss-gold-o','kappe-polo-schwarz-gold-o','kappe-ribbed-gold-o','kappe-ribbed-schwarz-o']:
    head(TJ+nm+'.webp',PX/17.0,nm.replace('-o','')+'-b')
json.dump(meta,open(OUT+'meta.json','w'),indent=1);print(meta)
