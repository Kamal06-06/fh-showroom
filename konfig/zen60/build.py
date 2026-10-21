import cv2, numpy as np, json, os
from PIL import Image
PX=14.0; W,H=1540,2002; XC,YB=772.1,1996.4
OUT='/home/claude/fh-showroom/konfig/zen60/'; os.makedirs(OUT,exist_ok=True)
NB='/home/claude/fh-showroom/konfig/b2050/'
BW=52*PX; NECK=7.3708; BH=(98-NECK)*PX; SH=YB-BH
def place(c,img,x,y):
    h,w=img.shape[:2];c[y:y+h,x:x+w]=np.minimum(c[y:y+h,x:x+w],img)
def toprow(g,thr):
    for y in range(g.shape[0]):
        r=np.where(g[y])[0]
        if len(r) and r.max()-r.min()>thr: return y
src='b6995752-image.png'
im=cv2.imread(src);g=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY)<236
r=np.where(g[800])[0];x0,x1=r.min(),r.max();bw=x1-x0
yb=np.where(g.any(1))[0].max()
ys=800
while True:
    rr=np.where(g[ys-1])[0]
    if len(rr) and rr.max()-rr.min()<0.5*bw: break
    ys-=1
print('body top',ys)
pad=25
body=cv2.resize(im[ys:yb+3,x0-pad:x1+pad],(int(round((bw+2*pad)*BW/bw)),int(round((yb-ys+3)*BH/(yb-ys)))),interpolation=cv2.INTER_LANCZOS4)
tube=np.full((H,W,3),255,np.uint8)
place(tube,body[:H-int(round(SH))],int(round(XC-body.shape[1]/2)),int(round(SH)))
# neck from Noble Line bare base
nb=cv2.cvtColor(np.array(Image.open(NB+'b2050-base-leer.webp').convert('RGB')),cv2.COLOR_RGB2BGR)
y0=int(round(YB-(100-NECK)*PX))
neck=nb[y0-150:y0+2,int(XC-140):int(XC+140)]
place(tube,neck,int(XC-140),int(round(SH))-150)
# leer: mirror left half of body to the right (dip tube runs right of center), then inpaint the centre strip
leer=tube.copy()
xc=int(round(XC));yA=int(SH)+8
left=tube[yA:,xc-420:xc]
leer[yA:,xc:xc+420]=left[:,::-1]
gr=cv2.cvtColor(leer,cv2.COLOR_BGR2GRAY).astype(np.int16)
bgg=cv2.cvtColor(cv2.medianBlur(leer,41),cv2.COLOR_BGR2GRAY).astype(np.int16)
m=np.zeros(gr.shape,np.uint8);yB=int(YB-25*PX)
m[yA+5:yB,xc-22:xc+22]=(np.abs(gr-bgg)[yA+5:yB,xc-22:xc+22]>4).astype(np.uint8)*255
yT=int(SH)-4
m[yT:yT+60,xc-45:xc+45]=np.maximum(m[yT:yT+60,xc-45:xc+45],(np.abs(gr-bgg)[yT:yT+60,xc-45:xc+45]>3).astype(np.uint8)*255)
m=cv2.dilate(m,np.ones((5,5),np.uint8))
leer=cv2.inpaint(leer,m,9,cv2.INPAINT_TELEA)
# replace the dip-tube adapter block at the top centre with the mirrored strip just beside it
for y in range(int(SH)-3,int(SH)+88):
    row=leer[y].copy()
    lft=row[xc-110:xc-46].astype(np.float32);rgt=row[xc+46:xc+110].astype(np.float32)
    for i,x in enumerate(range(xc-46,xc+46)):
        t=i/91.0
        leer[y,x]=(lft[-1]*(1-t)+rgt[0]*t).astype(np.uint8)
pt=leer[int(SH)-3:int(SH)+88,xc-60:xc+60];leer[int(SH)-3:int(SH)+88,xc-60:xc+60]=cv2.GaussianBlur(pt,(1,9),0)
for n,c in (('tube',tube),('leer',leer)):
    Image.fromarray(cv2.cvtColor(c,cv2.COLOR_BGR2RGB)).save(OUT+'zen60-base-'+n+'.webp',quality=90)
a=np.array(Image.open(OUT+'zen60-base-tube.webp').convert('L'))<236
for y in range(int(SH)-200,int(SH)+80):
    xs=np.where(a[y])[0]
    if len(xs) and xs.max()-xs.min()>0.6*BW: edge=y;break
print('SH',SH,'edge',edge)
meta={'shoulder':edge}
# caps from images
for f,name in [('31a2d08e','zen-matt'),('91201c2d','zen-glanz'),('b6995752','zen-gold')]:
    im=cv2.imread(f+'-image.png');gg=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY)
    g=gg<236; r=np.where(g[800])[0];bw=r.max()-r.min();s=BW/bw
    yt=np.where(g.any(1))[0].min()
    # bottom of cap = last row above bottle top where width < 0.5*bw after collar
    yc2=800
    while True:
        rr=np.where(g[yc2-1])[0]
        if len(rr) and rr.max()-rr.min()<0.5*bw: break
        yc2-=1
    cx=(r.min()+r.max())/2
    c=im[yt-3:yc2,int(cx-0.45*bw):int(cx+0.45*bw)]
    gf=gg[yt-3:yc2,int(cx-0.45*bw):int(cx+0.45*bw)].astype(np.float32)
    al=np.clip((250-gf)/25,0,1);mask=np.zeros_like(al)
    for y in range(al.shape[0]):
        xs=np.where(al[y]>0.5)[0]
        if len(xs): mask[y,xs.min():xs.max()+1]=1
    al=cv2.GaussianBlur(np.maximum(al,mask),(3,3),0)
    rgba=np.dstack([c,(al*255).astype(np.uint8)])
    rgba=cv2.resize(rgba,(int(round(rgba.shape[1]*s)),int(round(rgba.shape[0]*s))),interpolation=cv2.INTER_LANCZOS4)
    Image.fromarray(cv2.cvtColor(rgba,cv2.COLOR_BGRA2RGBA)).save(OUT+'kappe-'+name+'.webp',quality=92)
    meta['kappe-'+name]=[int(round(XC-rgba.shape[1]/2)),int(edge+2-rgba.shape[0])]
    print(name,'w mm',rgba.shape[1]/PX,'h mm',rgba.shape[0]/PX)
nm=json.load(open(NB+'meta.json'))
for k in ['spr-fea15-gold-b','spr-fea15-silber-b','spr-fea15-schwarz-b']:
    meta[k]=[nm[k][0],nm[k][1]+edge-nm['shoulder']]
json.dump(meta,open(OUT+'meta.json','w'),indent=1);print(meta)
ims=[]
for b,h,d in [('tube','kappe-zen-matt',OUT),('tube','kappe-zen-glanz',OUT),('tube','kappe-zen-gold',OUT),('tube','spr-fea15-gold-b',NB),('leer',None,None)]:
    cc=Image.open(OUT+'zen60-base-'+b+'.webp').convert('RGB')
    if h:L=Image.open(d+h+'.webp');cc.paste(L,tuple(meta[h]),L)
    ims.append(cc.resize((385,500)))
o=Image.new('RGB',(385*5,500),'white')
for i,x in enumerate(ims):o.paste(x,(i*385,0))
o.save('/tmp/zen.jpg')
