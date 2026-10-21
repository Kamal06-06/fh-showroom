import cv2, numpy as np
from PIL import Image
PX=16.0; W,H=1540,2002; XC,YB=772.1,1996.4
D='/home/claude/fh-showroom/konfig/sel50/'
SH50=YB-(80.3-8.0)*PX            # 839.6
BW,BH=48*PX,(68-8.0)*PX           # 30 ml body
SH=YB-BH
fx,fy=48/56,(68-8.0)/(80.3-8.0)
for n in ('leer','tube'):
    im=cv2.cvtColor(np.array(Image.open(D+'sel50-base-'+n+'.webp').convert('RGB')),cv2.COLOR_RGB2BGR)
    c=np.full((H,W,3),255,np.uint8)
    y0=int(round(SH50))
    body=im[y0:H]
    body=cv2.resize(body,(int(round(W*fx)),int(round((H-y0)*fy))),interpolation=cv2.INTER_AREA)
    by=int(round(SH)); bx=int(round(XC-XC*fx))
    h=min(body.shape[0],H-by); c[by:by+h,bx:bx+body.shape[1]]=np.minimum(c[by:by+h,bx:bx+body.shape[1]],body[:h])
    x0,x1=int(XC-210),int(XC+210)
    neck=im[y0-150:y0+3,x0:x1]
    ny=by-150
    c[ny:ny+neck.shape[0],x0:x1]=np.minimum(c[ny:ny+neck.shape[0],x0:x1],neck)
    Image.fromarray(cv2.cvtColor(c,cv2.COLOR_BGR2RGB)).save(D+'sel30-base-'+n+'.webp',quality=90)
    cv2.imwrite('/tmp/sel30_'+n+'.jpg',c)
a=np.array(Image.open(D+'sel30-base-tube.webp').convert('L'))<236
for y in range(int(SH)-200,int(SH)+80):
    xs=np.where(a[y])[0]
    if len(xs) and xs.max()-xs.min()>0.6*BW: edge=y;break
print('SH',SH,'edge',edge,'sh30',YB-(YB-edge)*0.906)
