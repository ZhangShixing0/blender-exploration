"""Editable pilot launch. Input points use the web scene's Y-up coordinates."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
def p(v): return Vector((v[0],-v[2],v[1]))
def mat(name,color,metal=0,rough=.5):
    h=color.lstrip('#');c=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    c=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in c]
    m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
    s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=(*c,1)
    s.inputs['Metallic'].default_value=metal;s.inputs['Roughness'].default_value=rough
    return m
ivory=mat('Paint | warm ivory','#e4dfcf');navy=mat('Paint | harbor blue','#365a68');wood=mat('Oiled teak','#a88254',0,.65)
darkwood=mat('Teak seams','#67513c');glass=mat('Cabin glass','#47717c',.3,.18);brass=mat('Aged brass','#c3a367',.6,.32)
rubber=mat('Fenders','#3b4548');rope=mat('Natural rope','#c9b58d');red=mat('Lifebuoy ochre red','#ad5943')
def mesh(name,verts,faces,materials):
    d=bpy.data.meshes.new(name);d.from_pydata([p(v) for v in verts],[],faces);d.update()
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o)
    for m in materials:d.materials.append(m)
    return o
def box(name,position,size,material,bevel=.008):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p(position));o=bpy.context.object;o.name=name
    o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(material)
    if bevel:
        mod=o.modifiers.new('Rounded manufactured edges','BEVEL');mod.width=bevel;mod.segments=3
        o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return o
def tube(name,points,r,material,closed=False):
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=r;c.bevel_resolution=3;c.resolution_u=12
    sp=c.splines.new('POLY');sp.points.add(len(points)-1)
    for a,b in zip(sp.points,points):a.co=(*p(b),1)
    sp.use_cyclic_u=closed;o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);o.data.materials.append(material);return o
def ellipsoid(name,position,scale,material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,location=p(position));o=bpy.context.object;o.name=name;o.scale=(scale[0],scale[2],scale[1]);o.data.materials.append(material)
    for poly in o.data.polygons:poly.use_smooth=True
    return o
def width(z):
    return .27*math.sqrt(max(0,1-((z+.07)/.71)**2))
stations=[-.48+i*1.12/40 for i in range(41)]
outline=[(-width(z),z) for z in stations]+[(width(z),z) for z in stations[-2::-1]]
N=len(outline);verts=[];levels=[(-.17,.48),(-.12,.70),(-.035,.9),(.065,1),(.095,1.015),(.125,1.015)]
for y,scale in levels:
    verts += [(x*scale,y,(z-.03)*(.92 if y<-.1 else 1)+.03) for x,z in outline]
faces=[]
for j in range(len(levels)-1):
    for i in range(N):faces.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
faces.append(tuple(range(N-1,-1,-1)))
hull=mesh('Pilot launch | continuous rounded hull',verts,faces,[navy,ivory])
for poly in hull.data.polygons:poly.material_index=1 if N<=poly.index<3*N else 0;poly.use_smooth=True
mesh('Teak deck',[(x*.94,.126,z) for x,z in outline],[tuple(range(N))],[wood])
tube('Continuous ivory gunwale',[(x*1.015,.137,z) for x,z in outline],.012,ivory,True)
for x in [-.20,-.15,-.10,-.05,0,.05,.1,.15,.2]:
    zs=[z for z in stations if width(z)*.90>abs(x)]
    if zs:tube('Teak plank caulking',[(x,.127,zs[0]),(x,.127,zs[-1])],.0015,darkwood)
# Low cabin, front towards +Z. Window frames sit directly on the cabin shell.
box('Wheelhouse ivory shell',(0,.255,.01),(.335,.25,.34),ivory,.025)
box('Wheelhouse teak roof',(0,.392,.0),(.385,.035,.40),navy,.018)
for x in [-.081,.081]:
    box('Front windshield brass frame',(x,.29,.185),(.145,.13,.012),brass,.01)
    box('Front windshield blue glass',(x,.29,.193),(.122,.107,.007),glass,.009)
for side in [-1,1]:
    for z in [-.075,.075]:
        box('Side window frame',(side*.17,.285,z),(.012,.132,.125),brass,.008)
        box('Side window glass',(side*.178,.285,z),(.006,.109,.102),glass,.006)
    tube('Roof handhold',[(side*.14,.415,-.13),(side*.14,.437,-.13),(side*.14,.437,.12),(side*.14,.415,.12)],.005,brass)
box('Cabin rear door',(0,.255,-.166),(.14,.20,.014),wood,.009)
box('Rear door light',(0,.295,-.175),(.10,.085,.008),glass,.005)
ellipsoid('Door handle',(.053,.24,-.178),(.008,.008,.008),brass)
box('Stern seat',(0,.18,-.365),(.32,.035,.11),wood,.012)
for x in [-.13,.13]:box('Seat support',(x,.15,-.365),(.025,.055,.065),ivory,.004)
for side in [-1,1]:
    points=[]
    for z in [.26,.37,.47]:
        x=side*(width(z)-.028);tube('Bow rail stanchion',[(x,.14,z),(x,.245,z)],.006,brass);points.append((x,.245,z))
    points.append((0,.245,.595));tube('Curved bow rail',points,.007,brass)
    for z in [-.28,.25]:
        x=side*(width(z)+.012);ellipsoid('Hanging fender',(x,.045,z),(.025,.077,.025),rubber)
        tube('Fender tie',[(side*(width(z)-.006),.15,z),(x,.11,z)],.003,rope)
    for z in [-.41,.43]:
        x=side*(width(z)-.045);tube('Mooring cleat',[(x-.025,.15,z),(x+.025,.15,z)],.007,brass)
        box('Cleat foot',(x,.139,z),(.018,.018,.018),brass,.003)
# Lifebuoy on the cabin's port side, attached with two brackets.
ring_vertices=[];ring_faces=[]
for i in range(48):
    a=i*math.tau/48
    for j in range(10):
        b=j*math.tau/10;r=.065+.014*math.sin(b)
        ring_vertices.append((-.193+.014*math.cos(b),.27+r*math.cos(a),-.015+r*math.sin(a)))
for i in range(48):
    for j in range(10):ring_faces.append((i*10+j,((i+1)%48)*10+j,((i+1)%48)*10+(j+1)%10,i*10+(j+1)%10))
life_ring=mesh('Continuous striped lifebuoy',ring_vertices,ring_faces,[ivory,red])
for poly in life_ring.data.polygons:poly.material_index=(poly.index//60)%2;poly.use_smooth=True
for y in [.22,.32]:box('Life ring bracket',(-.18,y,-.015),(.035,.012,.015),brass,.003)
coil=[]
for i in range(161):
    a=i/160*math.tau*3;r=.025+i/160*.025;coil.append((.07+r*math.cos(a),.15,-.34+r*math.sin(a)))
tube('Coiled mooring rope',coil,.004,rope)
tube('Short signal mast',[(0,.41,-.085),(0,.57,-.085)],.009,brass)
ellipsoid('Navigation lamp',(0,.575,-.085),(.019,.022,.019),ivory)
box('Roof hatch',(0,.416,.07),(.10,.016,.10),wood,.006)
box('Stern nameplate',(0,.055,-.485),(.16,.045,.008),brass,.003)
# Keep a native editable file and a compact web asset from the same geometry.
scene=bpy.context.scene;scene.world=bpy.data.worlds.new('Studio');scene.world.color=(.3,.3,.3)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scenes/pilot-launch-v336.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'web/暮色海港3d/assets/pilot-launch-v336.glb'),export_format='GLB',export_apply=True,export_cameras=False,export_lights=False)
bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();coords=[]
for obj in scene.objects:
    e=obj.evaluated_get(deps)
    if e.type in {'MESH','CURVE'}:
        data=e.to_mesh()
        for c in data.vertices:
            w=e.matrix_world@c.co;coords.append((w.x,w.z,-w.y))
        e.to_mesh_clear()
report={'objects':len(scene.objects),'min':[min(v[i] for v in coords) for i in range(3)],'max':[max(v[i] for v in coords) for i in range(3)]}
(ROOT/'checks/harbor-web-v3/boat-v336-build.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(report)
