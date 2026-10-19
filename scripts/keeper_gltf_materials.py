"""Carry Blender's fabric sheen weight into the static review GLB."""
import json
import struct
from pathlib import Path


def match_sheen(path, materials):
    path = Path(path)
    raw = path.read_bytes()
    size, kind = struct.unpack_from('<II', raw, 12)
    assert kind == 0x4E4F534A
    document = json.loads(raw[20:20 + size])
    changes = []
    for material in document.get('materials', []):
        sheen = material.get('extensions', {}).get('KHR_materials_sheen')
        source = materials.get(material.get('name'))
        if not sheen or not source or not source.use_nodes:
            continue
        shader = next((n for n in source.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not shader or shader.inputs['Sheen Weight'].is_linked:
            continue
        weight = shader.inputs['Sheen Weight'].default_value
        tint = shader.inputs['Sheen Tint'].default_value
        factor = [float(c * weight) for c in tint[:3]]
        sheen['sheenColorFactor'] = factor
        sheen['sheenRoughnessFactor'] = float(shader.inputs['Sheen Roughness'].default_value)
        changes.append({'material': material['name'], 'sheenColorFactor': factor})
    encoded = json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    encoded += b' ' * (-len(encoded) % 4)
    remainder = raw[20 + size:]
    path.write_bytes(struct.pack('<4sII', b'glTF', 2, 20 + len(encoded) + len(remainder))
                     + struct.pack('<II', len(encoded), kind) + encoded + remainder)
    return changes


if __name__ == '__main__':
    import bpy
    folder = Path(__file__).resolve().parents[1] / 'experiments/keeper-a-20261017'
    bpy.ops.wm.open_mainfile(filepath=str(folder / 'keeper-a-refined.blend'))
    changes = match_sheen(folder / 'keeper-a-refined.glb', bpy.data.materials)
    report_path = folder / 'refinement-report.json'
    report = json.loads(report_path.read_text(encoding='utf-8'))
    report['exportMaterialCorrections'] = changes
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('SHEEN_CORRECTIONS', json.dumps(changes))
