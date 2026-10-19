"""Runtime derivatives of the three approved figures. Never overwrite their sources.

Bake evaluated clothes and the fisher's post-armature proportion cage, then bind
to a new rest rig in the approved relaxed pose. This preserves the accepted
silhouette exactly at rest while retaining deformable limbs for interaction.
"""
import bpy,sys,json,hashlib
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).parent))
from keeper_gltf_materials import match_sheen
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'web/暮色海港3d/assets/cast-v340';OUT.mkdir(parents=True,exist_ok=True)
CHECK=ROOT/'checks/harbor-v340-20261019';CHECK.mkdir(parents=True,exist_ok=True)
SOURCES={'keeper':'experiments/keeper-a-20261017/keeper-a-neckfix.blend','fisher':'experiments/harbor-cast-20261018/fisher-v3.blend','visitor':'experiments/harbor-cast-20261018/visitor.blend'}
hashes={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in SOURCES.values()}
report=[]
def shorten_legs(point):
 # Feet stay unchanged. Shorten shin/thigh, ease into a rigid torso translation.
 p=point.copy();z=p.z
 if z>.20:p.z=.20+(min(z,.90)-.20)*.72+max(0,min(z,1.05)-.90)*.90+max(0,z-1.05)
 return p

for role,path in SOURCES.items():
 print('EXPORTING',role,flush=True)
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/path))
 scene=bpy.context.scene;source_rig=bpy.data.objects['Armature'];deps=bpy.context.evaluated_depsgraph_get()
 sources=[o for o in scene.objects if o.type=='MESH' and o.name!='Studio ground' and o.data.polygons]
 bones=list(source_rig.pose.bones);positions=[]
 for b in bones:
  positions.extend([source_rig.matrix_world@b.head,source_rig.matrix_world@b.tail,source_rig.matrix_world@(b.head+b.matrix.to_3x3().col[2]*.03)])
 # Transform the actual bone pivots through the same cage as the accepted mesh.
 cage=next((o for o in scene.objects if o.type=='LATTICE'),None)
 if cage:
  me=bpy.data.meshes.new('pivot probes');me.from_pydata(positions,[],[])
  probe=bpy.data.objects.new('pivot probes',me);scene.collection.objects.link(probe)
  mod=probe.modifiers.new('accepted proportions','LATTICE');mod.object=cage
  deps=bpy.context.evaluated_depsgraph_get()
  positions=[v.co.copy() for v in probe.evaluated_get(deps).data.vertices]
  bpy.data.objects.remove(probe,do_unlink=True)
 positions=[shorten_legs(p) for p in positions]
 rigdata=bpy.data.armatures.new(role+' accepted rest rig');rig=bpy.data.objects.new(role+' runtime armature',rigdata);scene.collection.objects.link(rig)
 bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
 for i,b in enumerate(bones):
  edit=rigdata.edit_bones.new(b.name);edit.head=positions[i*3];edit.tail=positions[i*3+1]
  edit.align_roll(positions[i*3+2]-positions[i*3]);edit.use_deform=b.bone.use_deform
 for b in bones:
  if b.parent:rigdata.edit_bones[b.name].parent=rigdata.edit_bones[b.parent.name]
 bpy.ops.object.mode_set(mode='OBJECT');rig.select_set(False)
 exports=[];weightless=0;foot=[]
 deps=bpy.context.evaluated_depsgraph_get()
 for source in sources:
  me=bpy.data.meshes.new_from_object(source.evaluated_get(deps),depsgraph=deps,preserve_all_data_layers=True)
  me.transform(source.matrix_world)
  for vertex in me.vertices:vertex.co=shorten_legs(vertex.co)
  obj=bpy.data.objects.new(source.name+' runtime',me);scene.collection.objects.link(obj);exports.append(obj)
  for group in source.vertex_groups:obj.vertex_groups.new(name=group.name)
  missing=[v.index for v in me.vertices if not v.groups]
  weightless+=len(missing)
  if missing:
   group=obj.vertex_groups.get('spine_03') or obj.vertex_groups.new(name='spine_03');group.add(missing,1,'REPLACE')
  if me.uv_layers:
   values=[tuple(t.uv) for t in me.uv_layers.active.data]
   for layer in list(me.uv_layers):me.uv_layers.remove(layer)
   common=me.uv_layers.new(name='UVMap')
   for datum,value in zip(common.data,values):datum.uv=value
  if 'Boot sole' in source.name:
   points=[v.co for v in me.vertices];z=min(v.z for v in points)
   sole=[v for v in points if v.z<z+.008]
   x=sum(v.x for v in sole)/len(sole);lo=min(v.y for v in sole);hi=max(v.y for v in sole)
   foot.extend([[x,z,-(lo+(hi-lo)*t)] for t in [.25,.5,.75]])
  if source.name not in ['Eyes','Eyebrows'] and len(me.polygons)>500:
   bpy.context.view_layer.objects.active=obj
   mod=obj.modifiers.new('Runtime detail reduction','DECIMATE');mod.ratio=.42 if source.name=='Keeper face neck and hands' else .025 if 'continuous knit' in source.name else .14
   bpy.ops.object.modifier_apply(modifier=mod.name)
 bpy.ops.object.select_all(action='DESELECT')
 for obj in exports:obj.select_set(True)
 bpy.context.view_layer.objects.active=exports[0];bpy.ops.object.join();mesh=bpy.context.object;mesh.name=role+' approved character'
 # Limit to four influences and normalize after combining all garment groups.
 bpy.ops.object.vertex_group_limit_total(limit=4);bpy.ops.object.vertex_group_normalize_all(lock_active=False)
 mod=mesh.modifiers.new('Runtime skeleton','ARMATURE');mod.object=rig;mesh.parent=rig
 bpy.context.view_layer.update()
 evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
 rest_error=max((a.co-b.co).length for a,b in zip(mesh.data.vertices,evaluated.data.vertices))
 assert rest_error<1e-5,(role,'rest mismatch',rest_error)
 # Runtime texture packing is verified by optimize_harbor_textures.py after export.
 # Blender may reuse original packed bytes even after image.scale().
 for image in bpy.data.images:
  if image.has_data and image.source!='VIEWER' and max(image.size)>1024:
   w,h=image.size;scale=1024/max(w,h);image.scale(round(w*scale),round(h*scale));image.pack()
 bpy.ops.object.select_all(action='DESELECT');mesh.select_set(True);rig.select_set(True)
 bpy.context.view_layer.objects.active=mesh
 dest=OUT/(role+'.glb')
 bpy.ops.export_scene.gltf(filepath=str(dest),export_format='GLB',use_selection=True,export_animations=False,export_cameras=False,export_lights=False,export_apply=False,export_skins=True,export_all_influences=False,export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,export_draco_position_quantization=16,export_draco_normal_quantization=12,export_draco_texcoord_quantization=14)
 sheen=match_sheen(dest,bpy.data.materials)
 raw=dest.read_bytes();import struct
 size=struct.unpack_from('<I',raw,12)[0];gltf=json.loads(raw[20:20+size])
 assert gltf.get('skins') and all('JOINTS_0' in p['attributes'] for m in gltf['meshes'] for p in m['primitives'])
 bounds=[[min(v.co[i] for v in mesh.data.vertices),max(v.co[i] for v in mesh.data.vertices)] for i in range(3)]
 row={'role':role,'source':path,'sourceSha256':hashes[path],'publishedSourceSha256':hashes[path],'file':dest.name,'bytes':dest.stat().st_size,'triangles':sum(len(p.vertices)-2 for p in mesh.data.polygons),'bones':len(rigdata.bones),'primitives':sum(len(m['primitives']) for m in gltf['meshes']),'restPoseMaxError':rest_error,'unweightedVerticesRepaired':weightless,'feet':foot,'nativeBounds':bounds,'sheenCorrections':sheen,'proportions':{'legScale':.72,'transitionScale':.90,'torsoTranslation':-.211,'faceShapeChanged':False}}
 report.append(row)
 (OUT/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print('EXPORTED',role,row['triangles'],row['bytes'],flush=True)
assert all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in hashes.items())
(CHECK/'export-report.json').write_text(json.dumps({'sourceFilesUnchanged':True,'characters':report},ensure_ascii=False,indent=2),encoding='utf-8')
