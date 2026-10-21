import cv2, numpy as np, json, os
from PIL import Image
PX=14.0; W,H=1540,2002; XC,YB=772.1,1996.4
OUT='/home/claude/fh-showroom/konfig/luna50/'; os.makedirs(OUT,exist_ok=True)
NB='/home/claude/fh-showroom/konfig/b2050/'; TJ='/home/claude/fh-showroom/konfig/okt50/'
NECK=7.3708; BW=50*PX; BH=(82-NECK)*PX; SH=YB-BH
def place(c,img,x,y):
    h,w=img.shape[:2];c[y:y+h,x:x+w]=np.minimum(c[y:y+h,x:x+w],img)
im=cv2.imread('5823ea6b-image.png');g=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY)<236
r=np.where(g[700])[0];x0,x1=r.min(),r.max();bw=x1-x0
yb=np.where(g.any(1))[0].max()
ys=410
pad=25
body=cv2.resize(im[ys:yb+3,x0-pad:x1+pad],(int(round((bw+2*pad)*BW/bw)),int(round((yb-ys+3)*BH/(yb-ys)))),interpolation=cv2.INTER_LANCZOS4)
tube=np.full((H,W,3),255,np.uint8)
place(tube,body[:H-int(round(SH))],int(round(XC-body.shape[1]/2)),int(round(SH)))
nb=cv2.cvtColor(np.array(Image.open(NB+'b2050-base-leer.webp').convert('RGB')),cv2.COLOR_RGB2BGR)
y0=int(round(YB-(100-NECK)*PX))
neck=nb[y0-150:y0+2,int(XC-110):int(XC+110)]
place(tube,neck,int(XC-110),int(round(SH))-150)
leer=tube.copy();xc=int(round(XC));yA=int(SH)+8
leer[yA:,xc:xc+420]=tube[yA:,xc-420:xc][:,::-1]
for y in range(int(SH)-3,int(SH)+70):
    lft=leer[y,xc-90:xc-40].astype(np.float32);rgt=leer[y,xc+40:xc+90].astype(np.float32)
    for i,x in enumerate(range(xc-40,xc+40)):
        t=i/79.0;leer[y,x]=(lft[-1]*(1-t)+rgt[0]*t).astype(np.uint8)
for y in range(int(SH)+60,int(SH)+230):
    lft=leer[y,xc-40:xc-16].astype(np.float32);rgt=leer[y,xc+16:xc+40].astype(np.float32)
    for i,x in enumerate(range(xc-16,xc+16)):
        t=i/31.0;leer[y,x]=(lft[-1]*(1-t)+rgt[0]*t).astype(np.uint8)
pt=leer[int(SH)-3:int(SH)+70,xc-55:xc+55];leer[int(SH)-3:int(SH)+70,xc-55:xc+55]=cv2.GaussianBlur(pt,(1,9),0)
for n,c in (('tube',tube),('leer',leer)):
    Image.fromarray(cv2.cvtColor(c,cv2.COLOR_BGR2RGB)).save(OUT+'luna50-base-'+n+'.webp',quality=90)
edge=int(round(SH));print('SH',SH)
meta={'shoulder':edge}
nm=json.load(open(NB+'meta.json'))
for k in ['spr-fea15-gold-b','spr-fea15-silber-b','spr-fea15-schwarz-b']:
    meta[k]=[nm[k][0],nm[k][1]+edge-nm['shoulder']]
k=PX/17.0
for nm2 in ['kappe-kugel-gold','kappe-kugel-weiss','kappe-kugel-schwarz']:
    L=Image.open(TJ+nm2+'.webp').convert('RGBA');L=L.resize((round(L.width*k),round(L.height*k)),Image.LANCZOS)
    al=np.array(L)[...,3];rb=np.where(al.max(1)>128)[0].max()
    L.save(OUT+nm2+'-l.webp',quality=92);meta[nm2+'-l']=[int(round(XC-L.width/2)),int(edge+6-rb)]
json.dump(meta,open(OUT+'meta.json','w'),indent=1);print(meta)
ims=[]
for b,h,d in [('tube','kappe-kugel-gold-l',OUT),('tube','kappe-kugel-weiss-l',OUT),('tube','kappe-kugel-schwarz-l',OUT),('tube','spr-fea15-gold-b',NB),('leer',None,None)]:
    cc=Image.open(OUT+'luna50-base-'+b+'.webp').convert('RGB')
    if h:L=Image.open(d+h+'.webp');cc.paste(L,tuple(meta[h]),L)
    ims.append(cc.resize((385,500)))
o=Image.new('RGB',(385*5,500),'white')
for i,x in enumerate(ims):o.paste(x,(i*385,0))
o.save('/tmp/luna.jpg')
