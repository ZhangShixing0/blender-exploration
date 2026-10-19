"""Repack actual encoded glTF image payloads; preserve all geometry/skin buffers.

Shared texture URLs let the three figures reuse decoded textures and HTTP cache.
Normals/roughness use lossless WebP, with resolution appropriate for web closeups.
"""
from pathlib import Path
from PIL import Image
from io import BytesIO
import json,struct,hashlib
ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'web/暮色海港3d/assets'
CHECK=ROOT/'checks/harbor-v340-20261019'
TEXTURES=ASSETS/'textures-v340';TEXTURES.mkdir(exist_ok=True)

def repack(source,destination):
 raw=source.read_bytes();n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);binary=raw[28+n:]
 images=[];removed=set();shared=set()
 for im in doc.get('images',[]):
  vi=im['bufferView'];view=doc['bufferViews'][vi];blob=binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
  image=Image.open(BytesIO(blob));old_size=list(image.size);name=im.get('name','').lower()
  normal='normal' in name;rough='rough' in name;scalar=rough or 'disp' in name
  maxsize=512 if normal or scalar else 1024
  if normal and 'superhero' not in name:maxsize=256
  if 'hair' in name:maxsize=512
  image.thumbnail((maxsize,maxsize),Image.Resampling.LANCZOS)
  if image.mode=='RGBA' and image.getchannel('A').getextrema()==(255,255):image=image.convert('RGB')
  output=BytesIO();image.save(output,format='WEBP',lossless=normal or scalar,quality=92,method=6)
  encoded=output.getvalue();digest=hashlib.sha256(encoded).hexdigest()[:24];target=TEXTURES/(digest+'.webp')
  if not target.exists():target.write_bytes(encoded)
  prefix='../textures-v340/' if destination.parent.name.startswith('cast-') else 'textures-v340/'
  im.pop('bufferView');im['mimeType']='image/webp';im['uri']=prefix+target.name
  removed.add(vi);shared.add(target.name)
  images.append({'name':name,'sourceSize':old_size,'size':list(image.size),'beforeBytes':len(blob),'afterBytes':len(encoded),'url':im['uri']})
 for texture in doc.get('textures',[]):
  if 'source' in texture:texture.setdefault('extensions',{})['EXT_texture_webp']={'source':texture.pop('source')}
 for field in ['extensionsUsed','extensionsRequired']:
  if 'EXT_texture_webp' not in doc.setdefault(field,[]):doc[field].append('EXT_texture_webp')
 result=bytearray();geometry_hash=hashlib.sha256()
 for i,view in enumerate(doc['bufferViews']):
  block=bytes(4) if i in removed else binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
  if i not in removed:geometry_hash.update(block)
  view['byteOffset']=len(result);view['byteLength']=len(block);result.extend(block);result.extend(bytes(-len(result)%4))
 doc['buffers'][0]['byteLength']=len(result)
 encoded=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode();encoded+=b' '*(-len(encoded)%4)
 destination.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(encoded)+len(result))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(result),0x004e4942)+result)
 return {'source':str(source.relative_to(ROOT)),'output':str(destination.relative_to(ROOT)),'oldBytes':len(raw),'geometryFileBytes':destination.stat().st_size,'uniqueTextures':list(shared),'images':images,'geometrySkinBufferSha256':geometry_hash.hexdigest()}

rows=[]
rows.append(repack(ASSETS/'moonlit-harbor-v331-water-contacts-draco.glb',ASSETS/'moonlit-harbor-v340-textures.glb'))
manifest=json.loads((ASSETS/'cast-v340/manifest.json').read_text(encoding='utf-8'))
for role in ['keeper','fisher','visitor']:
 path=ASSETS/f'cast-v340/{role}.glb';rows.append(repack(path,path))
 entry=next(c for c in manifest if c['role']==role);entry['bytes']=path.stat().st_size
(ASSETS/'cast-v340/manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False),encoding='utf-8')
unique=set(n for r in rows for n in r['uniqueTextures'])
total=sum(r['geometryFileBytes'] for r in rows)+sum((TEXTURES/n).stat().st_size for n in unique)
(CHECK/'texture-optimization.json').write_text(json.dumps({'assets':rows,'beforeTotalBytes':sum(r['oldBytes'] for r in rows),'afterTotalBytesWithSharedTextures':total},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'before':sum(r['oldBytes'] for r in rows),'after':total,'uniqueTextures':len(unique)}))
