import * as THREE from 'three';

const v=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const name=o=>(o.userData?.name||o.name||'').replaceAll('_',' ').toLowerCase();
const shown=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};

// Apply before static batching, so rendered geometry and picking agree.
export function repairKeeperBench(root){
  root.updateMatrixWorld(true);
  const parts=[],legs=[],fences=[],ground=[];
  root.traverse(o=>{
    if(!o.isMesh||!shown(o))return;
    const n=name(o);
    if(/^bench (seat plank|back plank|leg)/.test(n)){parts.push(o);if(n.startsWith('bench leg'))legs.push(o);}
    if(/^(fence rail|fence worn cap|oak fence post)/.test(n))fences.push(o);
    if(/^(upper turf cap|hand cut paving slab)/.test(n))ground.push(o);
  });
  if(parts.length!==9||legs.length!==4)throw new Error('Keeper bench source parts changed');
  const bounds=()=>parts.reduce((b,o)=>b.union(new THREE.Box3().setFromObject(o)),new THREE.Box3());
  const before=bounds(),delta=v(-.35,0,-.48);
  const shift=(o,d)=>o.position.copy(o.parent.worldToLocal(o.getWorldPosition(v()).add(d)));
  parts.forEach(o=>shift(o,delta));root.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(),contacts=legs.map(o=>{
    const b=new THREE.Box3().setFromObject(o),p=b.getCenter(v());p.y=b.min.y;
    ray.set(p.clone().add(v(0,.5,0)),v(0,-1,0));
    const hit=ray.intersectObjects(ground,false)[0];
    if(!hit||hit.distance>.75)throw new Error('Bench foot has no platform support');
    return {point:p,surface:hit.point.y};
  });
  delta.y=Math.max(...contacts.map(c=>c.surface-c.point.y))+.001;
  parts.forEach(o=>shift(o,v(0,delta.y,0)));root.updateMatrixWorld(true);

  const supports=new THREE.Group();supports.name='V341 keeper bench connected frame';root.add(supports);
  const iron=legs[0].material;
  function beam(label,a,b,r=.025){
    const direction=b.clone().sub(a),mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,direction.length(),12),iron);
    mesh.name='V341 bench '+label;mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(v(0,1,0),direction.normalize());mesh.castShadow=mesh.receiveShadow=true;
    supports.add(mesh);parts.push(mesh);
  }
  // Rear stiles join the existing legs/seat to both backrest boards.
  for(const x of [3.1,3.9]){
    beam('backrest stile',v(x+delta.x,3.69+delta.y,-3.275+delta.z),v(x+delta.x,4.155+delta.y,-3.275+delta.z));
    beam('seat bearer',v(x+delta.x,3.68+delta.y,-2.95+delta.z),v(x+delta.x,3.68+delta.y,-3.275+delta.z));
  }
  root.updateMatrixWorld(true);
  const after=bounds(),patch=after.clone();
  patch.min.add(v(-.10,-.13,-.10));patch.max.add(v(.10,.08,.28));
  let removedTriangles=0;
  root.traverse(o=>{
    if(!o.isMesh||!shown(o)||!/grass|flower|daisy|rooted stems|fern|pine fine needle canopy/.test(name(o))||/pot|trough/.test(name(o)))return;
    const clearance=/pine fine needle canopy/.test(name(o))?after.clone().expandByScalar(.04):patch;
    if(!new THREE.Box3().setFromObject(o).intersectsBox(clearance))return;
    const g=o.geometry,p=g.attributes.position,index=g.index,count=index?index.count:p.count;
    const parent=Int32Array.from({length:p.count},(_,i)=>i),at=i=>index?index.getX(i):i;
    const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
    // Weld position seams as well as shared indices; remove entire blades/stems.
    const welded=new Map();
    for(let i=0;i<p.count;i++){
      const key=[p.getX(i),p.getY(i),p.getZ(i)].map(n=>Math.round(n*1e5)).join(',');
      if(welded.has(key))parent[find(i)]=find(welded.get(key));else welded.set(key,i);
    }
    for(let i=0;i<count;i+=3){const a=find(at(i));parent[find(at(i+1))]=a;parent[find(at(i+2))]=a;}
    const cut=new Set(),point=v();
    for(let i=0;i<p.count;i++)if(clearance.containsPoint(point.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld)))cut.add(find(i));
    if(!cut.size)return;
    const kept=[],ranges=[],groups=g.groups.length?g.groups:[{start:0,count,materialIndex:0}];
    for(const group of groups){
      const start=kept.length;
      for(let i=group.start;i<group.start+group.count;i+=3){
        if(cut.has(find(at(i))))removedTriangles++;else kept.push(at(i),at(i+1),at(i+2));
      }
      ranges.push({...group,start,count:kept.length-start});
    }
    if(!kept.length){o.visible=false;return;}
    const clean=g.clone();clean.setIndex(kept);clean.clearGroups();
    for(const group of ranges)if(group.count)clean.addGroup(group.start,group.count,group.materialIndex);
    o.geometry=clean;
  });
  const boxDistance=(a,b)=>Math.hypot(...['x','y','z'].map(k=>Math.max(0,a.min[k]-b.max[k],b.min[k]-a.max[k])));
  const clearances=parts.flatMap(part=>fences.map(fence=>({part:part.name,fence:fence.name,gap:boxDistance(new THREE.Box3().setFromObject(part),new THREE.Box3().setFromObject(fence))})));
  const nearest=clearances.reduce((a,b)=>a.gap<b.gap?a:b);
  return {before:{min:before.min.toArray(),max:before.max.toArray()},after:{min:after.min.toArray(),max:after.max.toArray()},translation:delta.toArray(),nearestFence:nearest,
    footing:contacts.map(c=>({surface:c.surface,clearance:c.point.y+delta.y-c.surface})),addedSupports:supports.children.length,removedPlantTriangles:removedTriangles};
}
