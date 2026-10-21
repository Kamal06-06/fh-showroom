import cv2, numpy as np, json
from PIL import Image
PX=14.0; W,H=1540,2002; XC,YB=772.1,1996.4
NECK=7.3708; SH50=YB-(100-NECK)*PX
fx,fy=37/47,(84-NECK)/(100-NECK)
SH=YB-(84-NECK)*PX
for n in ('leer','tube'):
    im=cv2.cvtColor(np.array(Image.open('b2050-base-'+n+'.webp').convert('RGB')),cv2.COLOR_RGB2BGR)
    c=np.full((H,W,3),255,np.uint8); y0=int(round(SH50))
    cx0,cx1=int(XC-380),int(XC+380)
    body=cv2.resize(im[y0:H,cx0:cx1],(int(round((cx1-cx0)*fx)),int(round((H-y0)*fy))),interpolation=cv2.INTER_AREA)
    by=int(round(SH)); bx=int(round(XC-(XC-cx0)*fx)); h=min(body.shape[0],H-by)
    c[by:by+h,bx:bx+body.shape[1]]=np.minimum(c[by:by+h,bx:bx+body.shape[1]],body[:h])
    x0,x1=int(XC-140),int(XC+140); neck=im[y0-150:y0+2,x0:x1]; ny=by-150
    c[ny:ny+neck.shape[0],x0:x1]=np.minimum(c[ny:ny+neck.shape[0],x0:x1],neck)
    Image.fromarray(cv2.cvtColor(c,cv2.COLOR_BGR2RGB)).save('nbl30-base-'+n+'.webp',quality=90)
a=np.array(Image.open('nbl30-base-tube.webp').convert('L'))<236
for y in range(int(SH)-200,int(SH)+80):
    xs=np.where(a[y])[0]
    if len(xs) and xs.max()-xs.min()>0.85*37*PX: edge=y;break
print('SH',SH,'edge',edge)
m=json.load(open('meta.json'));ims=[]
for b,hd in [('tube','kappe-polo-weiss-gold-b'),('tube','kappe-zylinder-weiss-gold-b'),('tube','spr-fea15-gold-b'),('leer',None)]:
    for bb,sh in [('b2050',702),('nbl30',edge)]:
        cc=Image.open(bb+'-base-'+b+'.webp').convert('RGB')
        if hd:L=Image.open(hd+'.webp');cc.paste(L,(m[hd][0],m[hd][1]+sh-702),L)
        ims.append(cc.resize((308,400)))
o=Image.new('RGB',(308*8,400),'white')
for i,im in enumerate(ims):o.paste(im,(i*308,0))
o.save('/tmp/nbl30.jpg')
