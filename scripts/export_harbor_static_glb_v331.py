import bpy, hashlib, json, time
from pathlib import Path
R=Path(__file__).resolve().parents[1]
SRC=R/'scenes/moonlit-harbor-animation-v331-water-contacts.blend'
OUT=R/'web/暮色海港3d/assets/moonlit-harbor-v331-water-contacts-draco.glb'
(R/'checks/harbor-web-v3').mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SRC))
bpy.context.scene.frame_set(216)
start=time.time()
bpy.ops.export_scene.gltf(filepath=str(OUT),export_format='GLB',export_animations=False,
    export_cameras=False,export_lights=False,export_materials='EXPORT',export_apply=True,
    export_yup=True,use_selection=False,export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6)
report={'status':'passed','source':str(SRC.relative_to(R)),'file':str(OUT.relative_to(R)),
        'bytes':OUT.stat().st_size,'sha256':hashlib.sha256(OUT.read_bytes()).hexdigest(),
        'elapsed_seconds':round(time.time()-start,1)}
(R/'checks/harbor-web-v3/static-glb-export-v331.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False),flush=True)
