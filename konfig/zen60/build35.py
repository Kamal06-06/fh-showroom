import cv2, numpy as np, json
from PIL import Image
PX=14.0; W,H=1540,2002; XC,YB=772.1,1996.4
NECK=7.3708; SH60=YB-(98-NECK)*PX
fx,fy=47/52,(82-NECK)/(98-NECK)
SH=YB-(82-NECK)*PX
for n in ('leer','tube'):
    im=cv2.cvtColor(np.array(Image.open('zen60-base-'+n+'.webp').convert('RGB')),cv2.COLOR_RGB2BGR)
    c=np.full((H,W,3),255,np.uint8); y0=int(round(SH60))
    cx0,cx1=int(XC-420),int(XC+420)
    body=cv2.resize(im[y0:H,cx0:cx1],(int(round((cx1-cx0)*fx)),int(round((H-y0)*fy))),interpolation=cv2.INTER_AREA)
    by=int(round(SH)); bx=int(round(XC-(XC-cx0)*fx)); h=min(body.shape[0],H-by)
    c[by:by+h,bx:bx+body.shape[1]]=np.minimum(c[by:by+h,bx:bx+body.shape[1]],body[:h])
    x0,x1=int(XC-140),int(XC+140); neck=im[y0-150:y0+2,x0:x1]; ny=by-150
    c[ny:ny+neck.shape[0],x0:x1]=np.minimum(c[ny:ny+neck.shape[0],x0:x1],neck)
    Image.fromarray(cv2.cvtColor(c,cv2.COLOR_BGR2RGB)).save('zen35-base-'+n+'.webp',quality=90)
a=np.array(Image.open('zen35-base-tube.webp').convert('L'))<236
for y in range(int(SH)-200,int(SH)+80):
    xs=np.where(a[y])[0]
    if len(xs) and xs.max()-xs.min()>0.6*47*PX: edge=y;break
print('SH',SH,'edge',edge)
m=json.load(open('meta.json'));NB='../b2050/';ims=[]
for b,hd,d in [('tube','kappe-zen-gold',''),('tube','kappe-zen-matt',''),('tube','spr-fea15-gold-b',NB),('leer',None,'')]:
    for bb,sh in [('zen60',m['shoulder']),('zen35',edge)]:
        cc=Image.open(bb+'-base-'+b+'.webp').convert('RGB')
        if hd:L=Image.open(d+hd+'.webp');cc.paste(L,(m[hd][0],m[hd][1]+sh-m['shoulder']),L)
        ims.append(cc.resize((308,400)))
o=Image.new('RGB',(308*8,400),'white')
for i,x in enumerate(ims):o.paste(x,(i*308,0))
o.save('/tmp/zen35.jpg')
