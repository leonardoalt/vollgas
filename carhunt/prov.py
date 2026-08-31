import json,urllib.request,concurrent.futures,sys

UIDS = {
 'BMW M5 CS (thelightning)':'f28407cda1044fd28d82855be8af3e75',
 'BMW M6 Gran Coupe (BlackSnow02)':'f132152d91dd41bda8ae806ad6e4a5d2',
 'Mercedes AMG CLS (RADEONGAMER)':'4ef108f906e84bcaa3e66bed9b4cef9f',
 'BMW M3 E30 (Bexxie/Martin Trafas)':'ac3c7013434e403e8faff87948caf422',
 'Mercedes E-Class W212 (Peter_D)':'119c5e10733142b197aa53b86f6aeb04',
 'Audi A5 Sportback (unninterativa)':'aa9b8d495d324fa1adfe6eab519e21a9',
 'Audi RS5 (WillisChiejina)':'75d636ab26b1423ca61ffd0fd758fd0a',
 'BMW M3 Touring G81 (Car2022)':'2cb477b062ba4425aaa4742f581b5352',
 'Generic USA/EU Station wagon (anserkon)':'c14f271c9d414b8e8d25e7cec3bb44f5',
 'VW Passat B6 wagon (psadesign)':'f0a85fadb87b47aca2baec715acefce7',
 'Audi A7 Quattro (SRT Perfomance)':'6a500ff94b31446a88eeb69651729e0e',
 'BMW M8 F92 (sohyalebret)':'25d5b4f6d13e4217afa09bbf89f8d993',
 '2000 Audi A4 (tonielpro520)':'22f072849b6a409ebac3a0b13dbb099a',
 'Generic Sedan Car (mmcworks)':'58c33766470d46e7b2aed542650494e5',
 'Audi A4 B5 (mmcworks)':None,
}

def get(u):
    return json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=45))

def one(item):
    name,uid=item
    if not uid: return name,'(no uid)'
    try:
        d=get('https://api.sketchfab.com/v3/models/%s'%uid)
    except Exception as e:
        return name,'ERR %s'%e
    out=[]
    out.append('  license : %s'%(d.get('license') or {}).get('label'))
    out.append('  faces   : %s  verts: %s'%(d.get('faceCount'),d.get('vertexCount')))
    out.append('  user    : %s (%s)  modelCount=%s'%(d['user']['username'],d['user'].get('displayName'),d['user'].get('modelCount')))
    out.append('  tags    : %s'%','.join(t['name'] for t in d.get('tags',[])))
    out.append('  desc    : %s'%repr((d.get('description') or '')[:500]))
    return name,'\n'.join(out)

with concurrent.futures.ThreadPoolExecutor(10) as ex:
    for n,r in ex.map(one, UIDS.items()):
        print('=== %s'%n); print(r)
