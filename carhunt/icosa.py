import json,urllib.request,urllib.parse,sys

def get(u):
    return json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=60))

rows=[]
for q in ['car','sports car','sedan','coupe','porsche','bmw','supercar','vehicle']:
    for lic in ['CREATIVE_COMMONS_BY','CREATIVE_COMMONS_0']:
        for page in range(1,4):
            u='https://api.icosa.gallery/v1/assets?name=%s&license=%s&pageSize=100&pageToken=%d'%(urllib.parse.quote(q),lic,page)
            try: d=get(u)
            except Exception as e:
                print('ERR',q,lic,page,e); break
            a=d.get('assets') or []
            if not a: break
            for x in a:
                rows.append((x.get('triangleCount') or 0, x.get('displayName'), x.get('authorName'), x.get('assetId'), x.get('license'), x.get('licenseVersion')))
seen=set(); out=[]
for r in rows:
    if r[3] in seen: continue
    seen.add(r[3]); out.append(r)
out.sort(reverse=True)
print('unique assets:',len(out))
for r in out[:70]:
    print('%9d | %-42s | %-22s | %s | %s %s'%(r[0], str(r[1])[:42], str(r[2])[:22], r[3], r[4], r[5]))
