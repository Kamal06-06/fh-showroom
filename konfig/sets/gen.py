import json,re,sys
C=json.load(open('/tmp/cfg.json'));M=C['M'];SP=C['SP']
H={('rund','50'):'runder-flakon-50-ml-set',('sqg','50'):'square-grace-50-ml-set',('sqg','100'):'square-grace-100-ml-set',('octavia','50'):'true-jewel-50-ml-set',('octavia','100'):'true-jewel-100-ml-set',
('sel','50'):'square-elegance-50-ml-set',('sel','100'):'square-elegance-100-ml-set',('sel','30'):'square-elegance-30-ml-set',('sla','50'):'slim-aura-50-ml-set',('sla','30'):'slim-aura-30-ml-set',('sla','100'):'slim-aura-100-ml-set',
('nbl','50'):'noble-line-50-ml-set',('nbl','30'):'noble-line-30-ml-set',('zen','60'):'zen-corel-60-ml-set',('zen','35'):'zen-corel-35-ml-set',('zen','110'):'zen-corel-110-ml-set',('luna','50'):'luna-50-ml-set'}
ID={'runder-flakon-50-ml-set':16030430298495,'square-grace-50-ml-set':16030430331263,'square-grace-100-ml-set':16030430429567,'true-jewel-50-ml-set':16030493737343,'true-jewel-100-ml-set':16030526833023,'square-elegance-50-ml-set':16030549016959,'square-elegance-100-ml-set':16030566056319,'square-elegance-30-ml-set':16030576312703,'slim-aura-50-ml-set':16030623564159,'slim-aura-30-ml-set':16030633001343,'slim-aura-100-ml-set':16030635262335,'noble-line-50-ml-set':16030651449727,'noble-line-30-ml-set':16030660723071,'zen-corel-60-ml-set':16030690640255,'zen-corel-35-ml-set':16030706106751,'zen-corel-110-ml-set':16030708793727,'luna-50-ml-set':16030759551359}
CODE={'sqg':'SQG','rund':'RND','octavia':'TJW','sel':'SEL','sla':'SLA','nbl':'NBL','zen':'ZEN','luna':'LUN'}
def tiers(S):
    out=[('Muster (1 Set)',None)]
    ts=S['t']
    for i,t in enumerate(ts):
        nx=ts[i+1] if i+1<len(ts) else None
        if nx: lab=('%d Karton'%t['min'] if t['min']==1 else '%d Kartons'%t['min']) if nx['min']-t['min']==1 else '%d–%d Kartons'%(t['min'],nx['min']-1)
        else: lab='ab %d Kartons'%t['min']
        out.append(('Karton à %d Sets · %s'%(S['pcs'],lab),t))
    return out
def gen(mk,sz):
    Mo=M[mk];S=Mo['sizes'][sz];h=H[(mk,sz)]
    w=float(re.sub(r'[^0-9,]','',S['w']).replace(',','.'))
    caps=[(c['n'],c['p'],c['k']) for c in Mo['caps']]+[('Ohne Kappe',0,'X')]
    sprs=[('Mit Sprühkopf',SP),('Ohne Sprühkopf',0)]
    T=tiers(S);vs=[]
    for cn,cp,ck in caps:
        for sn,sp in sprs:
            if cn=='Ohne Kappe' and sn=='Ohne Sprühkopf': continue
            for i,(tl,t) in enumerate(T):
                if t is None: price=S['muster']['p']+sp+cp; g=w+25
                else: price=t['p']+S['pcs']*(sp+cp); g=S['pcs']*(w+25)+800
                ckc=''.join(x[0] for x in re.split(r'[ ·-]+',ck))[:3].upper()
                sku='SET-%s-%03d-%s-%s-%s'%(CODE[mk],int(sz),ckc,'S' if sp else 'O','M' if t is None else 'K%d'%t['min'])
                vs.append('{optionValues:[{optionName:"Kappe",name:"%s"},{optionName:"Sprühkopf",name:"%s"},{optionName:"Menge",name:"%s"}],price:"%.2f",sku:"%s",inventoryItem:{tracked:false,measurement:{weight:{unit:GRAMS,value:%d}}}}'%(cn,sn,tl,round(price+1e-9,2),sku,round(g)))
    opts='[{name:"Kappe",values:[%s]},{name:"Sprühkopf",values:[{name:"Mit Sprühkopf"},{name:"Ohne Sprühkopf"}]},{name:"Menge",values:[%s]}]'%(','.join('{name:"%s"}'%c[0] for c in caps),','.join('{name:"%s"}'%x[0] for x in T))
    q='mutation{productSet(synchronous:true,input:{id:"gid://shopify/Product/%d",productOptions:%s,variants:[\n%s]}){product{id variantsCount{count}} userErrors{field message}}}'%(ID[h],opts,',\n'.join(vs))
    return q,len(vs)
if __name__=='__main__':
    mk,sz=sys.argv[1],sys.argv[2];q,n=gen(mk,sz);open('q_%s_%s.gql'%(mk,sz),'w').write(q);print(n,len(q))
