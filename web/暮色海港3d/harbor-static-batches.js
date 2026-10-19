import * as THREE from 'three';
import {mergeGeometries} from './vendor/three/examples/jsm/utils/BufferGeometryUtils.js';

// Keep the authored objects on a raycast-only layer. Render their unchanged
// geometry in material batches, so thousands of tiles/planks cost few draw calls.
export function batchHarborStatics(root){
  root.updateMatrixWorld(true);const groups=new Map(),inverse=root.matrixWorld.clone().invert();
  const name=o=>(o.userData?.name||o.name||'').replaceAll('_',' ').toLowerCase();
  root.traverse(o=>{
    if(!o.isMesh||o.isSkinnedMesh||Array.isArray(o.material)||o.material.transparent||o.geometry.groups.length)return;
    for(let p=o;p&&p!==root;p=p.parent){
      if(!p.visible||/boat.*root|gull|seagull|^(lighthouse keeper|working fisher|cafe visitor) root$/.test(name(p)))return;
    }
    if(/water|seabed|sand patch|submerged|underwater|exposed|cut face|foam|beam|haze|halo|caustic/.test(name(o)))return;
    const attrs=Object.entries(o.geometry.attributes).map(([key,a])=>[key,a.itemSize,a.normalized,a.array.constructor.name]).sort();
    const key=o.material.uuid+'|'+JSON.stringify(attrs)+'|'+!!o.geometry.index;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);
  });
  let sourceMeshes=0,batches=0;
  for(const list of groups.values()){
    if(list.length<4)continue;
    const parts=list.map(o=>o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld)));
    const geometry=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());if(!geometry)continue;
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const batch=new THREE.Mesh(geometry,list[0].material);batch.name='V340 static display batch '+batches;
    batch.userData.staticBatch=true;batch.castShadow=list[0].castShadow;batch.receiveShadow=list[0].receiveShadow;
    root.add(batch);for(const o of list){o.layers.set(1);o.userData.raycastOnly=true;}
    sourceMeshes+=list.length;batches++;
  }
  return {sourceMeshes,batches,raycastLayer:1};
}
