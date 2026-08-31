import json,urllib.request,urllib.parse,sys

def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
    return json.load(urllib.request.urlopen(req,timeout=60))

lic=sys.argv[1]
queries=sys.argv[2:]
seen={}
for q in queries:
    url="https://api.sketchfab.com/v3/search?type=models&downloadable=true&count=24&license=%s&q=%s"%(lic,urllib.parse.quote(q))
    try:
        d=get(url)
    except Exception as e:
        print("ERR",q,e); continue
    res=d.get('results',[])
    print("=== %s (%s) : %d results"%(q,lic,len(res)))
    for r in res:
        u=r['uid']
        if u in seen: continue
        seen[u]=1
        print("  %s | %-45s | %-22s | fc=%s | %s"%(u, r['name'][:45], r['user']['username'][:22], r.get('faceCount'), (r.get('license') or {}).get('label')))
