import struct,json,sys,os
p=sys.argv[1]
f=open(p,'rb')
magic,ver,length=struct.unpack('<III',f.read(12))
assert magic==0x46546C67,'not glb'
j=None
binlen=0
while f.tell()<length:
    hdr=f.read(8)
    if len(hdr)<8: break
    clen,ctype=struct.unpack('<II',hdr)
    data=f.read(clen)
    if ctype==0x4E4F534A: j=json.loads(data.decode('utf-8'))
    else: binlen+=clen
g=j
tris=0
verts=0
for m in g.get('meshes',[]):
    for pr in m.get('primitives',[]):
        if 'indices' in pr:
            tris+=g['accessors'][pr['indices']]['count']//3
        pos=pr['attributes'].get('POSITION')
        if pos is not None: verts+=g['accessors'][pos]['count']
print('file            :',os.path.basename(p), os.path.getsize(p),'bytes')
print('glTF version    :',g.get('asset'))
print('triangles       :',tris)
print('vertices        :',verts)
print('meshes          :',len(g.get('meshes',[])))
print('nodes           :',len(g.get('nodes',[])))
print('materials       :',len(g.get('materials',[])))
print('images          :',len(g.get('images',[])),'bin bytes',binlen)
print('extensionsUsed  :',g.get('extensionsUsed'))
print('--- node names ---')
print(', '.join([n.get('name','?') for n in g.get('nodes',[])])[:3000])
print('--- material names ---')
print(', '.join([n.get('name','?') for n in g.get('materials',[])])[:2000])
print('--- image names/mime ---')
for i in g.get('images',[]):
    bv=i.get('bufferView')
    sz=g['bufferViews'][bv]['byteLength'] if bv is not None else None
    print('  ',i.get('name'),i.get('mimeType'),i.get('uri'),sz)
if 'extensions' in g:
    print('--- extensions ---', json.dumps(g['extensions'])[:1500])
