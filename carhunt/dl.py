import json,urllib.request,os,sys,concurrent.futures

repo=sys.argv[1]; path=sys.argv[2]; out=sys.argv[3]

def get(u): return json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=60))

def walk(p):
    items=get('https://api.github.com/repos/%s/contents/%s'%(repo,urllib.parse.quote(p)))
    for x in items:
        if x['type']=='dir': yield from walk(x['path'])
        else: yield x

import urllib.parse
files=list(walk(path))
total=0
def fetch(x):
    rel=os.path.relpath(x['path'],path)
    dst=os.path.join(out,rel)
    os.makedirs(os.path.dirname(dst),exist_ok=True)
    urllib.request.urlretrieve(x['download_url'],dst)
    return rel,os.path.getsize(dst)
with concurrent.futures.ThreadPoolExecutor(8) as ex:
    for rel,sz in ex.map(fetch,files):
        total+=sz
print('files',len(files),'TOTAL BYTES',total)
