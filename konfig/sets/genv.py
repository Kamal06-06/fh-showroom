import json,re,sys
sys.argv=['x','sel','30'];exec(open('gen.py').read().split("if __name__")[0])
def genv(mk,sz):
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
                vs.append({"optionValues":[{"optionName":"Kappe","name":cn},{"optionName":"Sprühkopf","name":sn},{"optionName":"Menge","name":tl}],"price":"%.2f"%round(price+1e-9,2),"sku":sku,"inventoryItem":{"tracked":False,"measurement":{"weight":{"unit":"GRAMS","value":round(g)}}}})
    opts=[{"name":"Kappe","values":[{"name":c[0]} for c in caps]},{"name":"Sprühkopf","values":[{"name":"Mit Sprühkopf"},{"name":"Ohne Sprühkopf"}]},{"name":"Menge","values":[{"name":x[0]} for x in T]}]
    return {"i":{"id":"gid://shopify/Product/%d"%ID[h],"productOptions":opts,"variants":vs}}
for mk,sz in [('sel','30'),('sel','50'),('sel','100'),('sla','30'),('sla','50'),('sla','100'),('octavia','50'),('octavia','100')]:
    d=genv(mk,sz);open('v_%s_%s.json'%(mk,sz),'w').write(json.dumps(d,ensure_ascii=False,separators=(',',':')))
    print(mk,sz,len(d['i']['variants']))
