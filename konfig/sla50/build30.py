import cv2, numpy as np, json
from PIL import Image
PX=14.0; W,H=1540,2002; XC,YB=772.1,1996.4
NECK=11.1537; SH50=YB-(102-NECK)*PX
fx,fy=32/41,(89-NECK)/(102-NECK)
SH=YB-(89-NECK)*PX
for n in ('leer','tube'):
    im=cv2.cvtColor(np.array(Image.open('sla50-base-'+n+'.webp').convert('RGB')),cv2.COLOR_RGB2BGR)
    c=np.full((H,W,3),255,np.uint8); y0=int(round(SH50))
    body=cv2.resize(im[y0:H],(int(round(W*fx)),int(round((H-y0)*fy))),interpolation=cv2.INTER_AREA)
    by=int(round(SH)); bx=int(round(XC-XC*fx)); h=min(body.shape[0],H-by)
    c[by:by+h,bx:bx+body.shape[1]]=np.minimum(c[by:by+h,bx:bx+body.shape[1]],body[:h])
    x0,x1=int(XC-175),int(XC+175); neck=im[y0-180:y0+3,x0:x1]; ny=by-180
    c[ny:ny+neck.shape[0],x0:x1]=np.minimum(c[ny:ny+neck.shape[0],x0:x1],neck)
    Image.fromarray(cv2.cvtColor(c,cv2.COLOR_BGR2RGB)).save('sla30-base-'+n+'.webp',quality=90)
a=np.array(Image.open('sla30-base-tube.webp').convert('L'))<236
for y in range(int(SH)-200,int(SH)+80):
    xs=np.where(a[y])[0]
    if len(xs) and xs.max()-xs.min()>0.85*32*PX: edge=y;break
print('SH',SH,'edge',edge)
m=json.load(open('meta.json'));ims=[]
for b,hd in [('tube','kappe-eckig-schwarz-a'),('tube','kappe-holz-natur-a'),('tube','spr-fea15-gold-a'),('leer',None)]:
    for bb,sh in [('sla50',725),('sla30',edge)]:
        cc=Image.open(bb+'-base-'+b+'.webp').convert('RGB')
        if hd:L=Image.open(hd+'.webp');cc.paste(L,(m[hd][0],m[hd][1]+sh-725),L)
        ims.append(cc.resize((308,400)))
o=Image.new('RGB',(308*8,400),'white')
for i,im in enumerate(ims):o.paste(im,(i*308,0))
o.save('/tmp/sla30.jpg')
