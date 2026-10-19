import * as THREE from 'three';
import {GLTFLoader} from './vendor/three/examples/jsm/loaders/GLTFLoader.js';
import {DRACOLoader} from './vendor/three/examples/jsm/loaders/DRACOLoader.js';

// Approved Blender figures, rebound in their accepted relaxed pose for animation.
const v=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const label=o=>(o.userData?.name||o.name||'').replaceAll('_',' ').toLowerCase();
const smooth=THREE.MathUtils.smoothstep;
const ASSETS=new URL('./assets/cast-v340/',import.meta.url);
// Keep HTTP caching, but not this bundled ImageBitmapLoader's promise cache:
// concurrent cache hits resolve without an ImageBitmap and produce black skin.
const specs=[{id:'keeper',root:'lighthouse keeper root',height:1.08},{id:'fisher',root:'working fisher root',height:1.04},{id:'visitor',root:'cafe visitor root',height:1.06}];

function clearStandingPlants(root,actor){
  // Remove whole connected blades/petals in the standing footprint, rather than
  // cutting their tips off or allowing the merged grass to pass through trousers.
  const center=actor.person.getWorldPosition(v()),patch=new THREE.Box3(center.clone().add(v(-.24,-.04,-.24)),center.clone().add(v(.24,.62,.24)));
  let removed=0;
  root.traverse(o=>{
    if(!o.isMesh||!/grass|wildflower|attached flower petals|flower stem|fern/.test(label(o)))return;
    for(let p=o;p;p=p.parent)if(!p.visible)return;
    if(!new THREE.Box3().setFromObject(o).intersectsBox(patch))return;
    const g=o.geometry,points=g.attributes.position,index=g.index,count=index?index.count:points.count;
    const parent=Int32Array.from({length:points.count},(_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;},at=i=>index?index.getX(i):i;
    for(let i=0;i<count;i+=3){const a=find(at(i));parent[find(at(i+1))]=a;parent[find(at(i+2))]=a;}
    const cut=new Set(),point=v();
    for(let i=0;i<points.count;i++){point.fromBufferAttribute(points,i).applyMatrix4(o.matrixWorld);if(patch.containsPoint(point)&&Math.hypot(point.x-center.x,point.z-center.z)<.24)cut.add(find(i));}
    if(!cut.size)return;
    const kept=[],groups=g.groups.length?g.groups:[{start:0,count,materialIndex:0}],ranges=[];
    for(const group of groups){const start=kept.length;for(let i=group.start;i<group.start+group.count;i+=3){if(cut.has(find(at(i)))){removed++;continue;}kept.push(at(i),at(i+1),at(i+2));}ranges.push({...group,start,count:kept.length-start});}
    const clean=g.clone();clean.setIndex(kept);clean.clearGroups();for(const group of ranges)if(group.count)clean.addGroup(group.start,group.count,group.materialIndex);o.geometry=clean;
  });
  return removed;
}

function groundActor(person,model,feet,ground){
  person.updateWorldMatrix(true,true);
  const ray=new THREE.Raycaster(),offsets=[0,-.06,.06,-.12,.12,-.20,.20].flatMap(x=>[0,-.06,.06,-.12,.12,-.20,.20].map(z=>[x,z])).sort((a,b)=>a[0]**2+a[1]**2-b[0]**2-b[1]**2);
  let best=null;
  for(const [dx,dz] of offsets){
    const contacts=feet.map(p=>{
      const foot=model.localToWorld(v(...p)).add(v(dx,0,dz));ray.set(foot.clone().add(v(0,.30,0)),v(0,-1,0));
      const hit=ray.intersectObjects(ground,false)[0];return hit&&hit.distance<.65?{foot,surface:hit.point.y,name:label(hit.object)}:null;
    });
    if(contacts.some(c=>!c))continue;
    const delta=contacts.map(c=>c.surface-c.foot.y),gap=Math.max(...delta)-Math.min(...delta);
    if(!best||gap<best.gap)best={contacts,gap,dx,dz,dy:Math.max(...delta)+.001};if(gap<.009)break;
  }
  if(!best)throw new Error(`No supported standing position for ${person.name}`);
  const position=person.getWorldPosition(v()).add(v(best.dx,best.dy,best.dz));person.position.copy(person.parent.worldToLocal(position));person.updateWorldMatrix(true,true);
  return best.contacts.map(c=>({surface:c.name,clearance:c.foot.y+best.dy-c.surface}));
}

function fishingRod(){
  const group=new THREE.Group();group.name='Fisher retractable fishing rod';
  const carbon=new THREE.MeshStandardMaterial({color:'#3d4c51',roughness:.48}),cork=new THREE.MeshStandardMaterial({color:'#bb9764',roughness:.9}),metal=new THREE.MeshStandardMaterial({color:'#b8b6a5',roughness:.38,metalness:.55});
  function rod(points,r,mat){group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>v(...p))),32,r,8,false),mat));}
  rod([[0,-.12,0],[0,.25,0],[0,.65,.012],[0,1.05,.045]],.0034,carbon);rod([[0,-.095,0],[0,.035,0]],.012,cork);
  const reel=new THREE.Mesh(new THREE.CylinderGeometry(.024,.024,.018,20),metal);reel.rotation.z=Math.PI/2;reel.position.set(.018,-.055,0);group.add(reel);
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([v(),v(),v()]),new THREE.LineBasicMaterial({color:'#c6cabb',transparent:true,opacity:.65}));group.add(line);
  const bobber=new THREE.Mesh(new THREE.SphereGeometry(.011,12,8),new THREE.MeshStandardMaterial({color:'#c76243'}));bobber.scale.y=1.8;group.add(bobber);group.userData.line=line;group.userData.bobber=bobber;group.visible=false;return group;
}

let castPromise;
export function preloadHarborCast(){
  if(!castPromise)castPromise=(async()=>{
  const draco=new DRACOLoader();draco.setDecoderPath('./vendor/three/examples/jsm/libs/draco/gltf/');const loader=new GLTFLoader();loader.setDRACOLoader(draco);
  let gltfs,manifest;globalThis.__harborLoadMetrics?.push({stage:'cast-load-start',ms:Math.round(performance.now())});
  try{[manifest,gltfs]=await Promise.all([
    fetch(new URL('manifest.json',ASSETS)).then(r=>{if(!r.ok)throw new Error('Character manifest unavailable');return r.json();}),
    Promise.all(specs.map(s=>loader.loadAsync(new URL(s.id+'.glb',ASSETS).href))),
  ]);}finally{draco.dispose();}
    globalThis.__harborLoadMetrics?.push({stage:'cast-decoded',ms:Math.round(performance.now())});
    return {gltfs,manifest};
  })();
  castPromise.catch(()=>{});return castPromise;
}

export async function repairHarborCharacters(root){
  // Do not briefly show the rejected figures while the accepted assets download.
  root.traverse(o=>{if(specs.some(s=>s.root===label(o)))o.children.forEach(c=>c.visible=false);});
  const {gltfs,manifest}=await preloadHarborCast();
  const ground=[],actors=[];root.updateMatrixWorld(true);
  root.traverse(o=>{if(o.isMesh&&/^(pier individual deck plank|hand cut paving slab|upper turf cap|cafe waterside terrace|lower harbor land)/.test(label(o)))ground.push(o);});
  for(let i=0;i<specs.length;i++){
    const spec=specs[i],data=manifest.find(m=>m.role===spec.id);let person;root.traverse(o=>{if(label(o)===spec.root)person=o;});
    if(!person)throw new Error(`Missing character anchor: ${spec.root}`);
    person.children.forEach(o=>o.visible=false);person.userData.castRole=spec.id;
    const model=gltfs[i].scene;model.name=`V340 proportioned ${spec.id}`;person.add(model);
    model.scale.setScalar(spec.height/(data.nativeBounds[2][1]-data.nativeBounds[2][0])/person.getWorldScale(v()).y);
    const bones={},rest=new Map(),skins=[];
    model.traverse(o=>{if(o.isBone){bones[o.name]=o;rest.set(o,o.quaternion.clone());}if(o.isMesh){o.castShadow=true;o.receiveShadow=false;o.frustumCulled=false;}if(o.isSkinnedMesh){skins.push(o);o.normalizeSkinWeights();}});
    for(const name of ['Head','upperarm_l','lowerarm_l','hand_l','upperarm_r','lowerarm_r','hand_r'])if(!bones[name])throw new Error(`Missing ${spec.id} bone ${name}`);
    const footing=groundActor(person,model,data.feet,ground),actor={id:spec.id,person,model,bones,rest,skins,footing,data};actors.push(actor);
    actor.waveStart=-100;actor.wasAnimating=false;
    const hand=bones.hand_l;model.updateMatrixWorld(true);
    const localPoint=name=>hand.worldToLocal(bones[name].getWorldPosition(v()));
    const finger=localPoint('middle_03_l').sub(localPoint('middle_01_l')).normalize();
    const across=localPoint('index_01_l').sub(localPoint('pinky_01_l'));across.addScaledVector(finger,-across.dot(finger)).normalize();
    actor.handBasis=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across,finger,across.clone().cross(finger))).invert();
    actor.clearedPlantTriangles=spec.id==='keeper'?clearStandingPlants(root,actor):0;
    if(spec.id==='fisher'){actor.rod=fishingRod();bones.hand_r.add(actor.rod);actor.rod.position.set(.008,.043,.018);actor.rod.rotation.set(.1,0,Math.PI/2);}
  }
  let fishing=false,fishingBlend=0,lastTime=null;
  // Rotate in model axes, accounting for the current parent pose and glTF basis.
  function rotate(a,name,axis,angle){
    if(!angle)return;const bone=a.bones[name];a.model.updateWorldMatrix(true,false);bone.parent.updateWorldMatrix(true,false);
    const direction=v(...axis).applyQuaternion(a.model.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
    bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(direction,angle));bone.updateWorldMatrix(false,true);
  }
  function update(time,until,reduced){
    const dt=lastTime===null?0:Math.min(.1,Math.max(0,time-lastTime));lastTime=time;fishingBlend=THREE.MathUtils.damp(fishingBlend,fishing?1:0,3.6,dt);if(!fishing&&fishingBlend<.001)fishingBlend=0;
    for(const a of actors){
      const age=time-a.waveStart,remaining=4.6-age;
      const lift=age>=0&&remaining>0?Math.min(smooth(age,0,1.1),smooth(remaining,0,1.2)):0;
      const active=lift>0||(a.id==='fisher'&&fishingBlend>0);
      if(!active&&!a.wasAnimating)continue;
      a.wasAnimating=active;
      for(const [bone,quat] of a.rest)bone.quaternion.copy(quat);a.model.updateMatrixWorld(true);
      rotate(a,'upperarm_l',[0,0,1],.78*lift);rotate(a,'upperarm_l',[1,0,0],-.18*lift);
      rotate(a,'lowerarm_l',[0,0,1],2.05*lift);rotate(a,'lowerarm_l',[1,0,0],.22*lift);
      if(lift>0){
        // Palm faces the front of the person, fingers point up. Sway at the wrist
        // without repeatedly swinging the shoulder through the torso.
        const sway=(reduced?.035:.19)*Math.sin(Math.max(0,age-1.1)*Math.PI*2*1.05)*smooth(age,1.1,1.4);
        const up=v(Math.sin(sway),Math.cos(sway),0),across=v(-up.y,up.x,0);
        const target=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across,up,across.clone().cross(up))).multiply(a.handBasis);
        const hand=a.bones.hand_l;hand.parent.updateWorldMatrix(true,false);
        target.premultiply(a.model.getWorldQuaternion(new THREE.Quaternion())).premultiply(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
        hand.quaternion.slerp(target,lift);
        for(const [name,bone] of Object.entries(a.bones)){
          if(/^(index|middle|ring|pinky)_0[123]_l$/.test(name)){
            bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(v(1,0,0),-.10*lift));
            if(name.includes('_01_')){const spread=name.startsWith('index')?-.06:name.startsWith('pinky')?.08:name.startsWith('ring')?.03:0;bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(v(0,0,1),spread*lift));}
          }
        }
        rotate(a,'Head',[1,0,0],.025*Math.sin(Math.PI*Math.min(1,age/1.1))*lift);
      }
      if(a.rod){
        rotate(a,'upperarm_r',[1,0,0],-.15*fishingBlend);rotate(a,'lowerarm_r',[1,0,0],-1.10*fishingBlend);a.rod.visible=fishingBlend>.18;
        if(a.rod.visible){
          const wrist=a.bones.hand_r;wrist.updateWorldMatrix(true,false);
          const direction=v(-.35,.75,.8).normalize().applyQuaternion(a.model.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(wrist.getWorldQuaternion(new THREE.Quaternion()).invert());
          a.rod.quaternion.setFromUnitVectors(v(0,1,0),direction);a.rod.updateWorldMatrix(false,true);
          const tip=a.rod.localToWorld(v(0,1.05,.045)),end=tip.clone().add(v(0,-.23,0));
          const local=[tip,tip.clone().lerp(end,.5).add(v(.005,0,0)),end].map(p=>a.rod.worldToLocal(p));
          const points=a.rod.userData.line.geometry.attributes.position;local.forEach((p,i)=>points.setXYZ(i,p.x,p.y,p.z));points.needsUpdate=true;
          a.rod.userData.line.geometry.computeBoundingSphere();a.rod.userData.bobber.position.copy(local[2]);
        }
      }
      a.model.updateMatrixWorld(true);for(const skeleton of new Set(a.skins.map(m=>m.skeleton)))skeleton.update();
    }
  }
  update(0,-1,false);
  function characterView(id,mobile=false){
    const a=actors.find(a=>a.id===id);if(!a)return null;a.person.updateWorldMatrix(true,true);
    const height=a.data.nativeBounds[2][1];return {position:a.model.localToWorld(v(.40,height*.84,mobile?4.0:3.5)).toArray(),target:a.model.localToWorld(v(0,height*.51,0)).toArray()};
  }
  return {actors,update,characterView,greet(id,time){const a=actors.find(a=>a.id===id);if(a)a.waveStart=time;},stopWaving(){actors.forEach(a=>a.waveStart=-100);},isWaving:time=>actors.some(a=>time>=a.waveStart&&time<a.waveStart+4.6),toggleFishing(){fishing=!fishing;return fishing;},stopFishing(){fishing=false;},inspect:()=>actors.map(a=>{
    a.person.updateWorldMatrix(true,true);const head=a.bones.Head.getWorldPosition(v()),hand=a.bones.hand_l.getWorldPosition(v()),box=new THREE.Box3().setFromObject(a.model);
    const point=name=>a.bones[name].getWorldPosition(v()),finger=point('middle_03_l').sub(point('middle_01_l')).normalize(),across=point('index_01_l').sub(point('pinky_01_l')).normalize();
    const front=v(0,0,1).applyQuaternion(a.model.getWorldQuaternion(new THREE.Quaternion()));
    const upper=point('lowerarm_l').sub(point('upperarm_l')),lower=hand.clone().sub(point('lowerarm_l'));
    return {id:a.id,head:head.toArray(),hand:hand.toArray(),handHeadDistance:hand.distanceTo(head),source:a.data.source,asset:a.data.file,boneCount:Object.keys(a.bones).length,skinnedMeshes:a.skins.length,
      palmFacingFront:finger.clone().cross(across).normalize().dot(front),fingerUpright: finger.y,elbowFlexionDegrees:THREE.MathUtils.radToDeg(upper.angleTo(lower)),
      oldVisible:a.person.children.filter(o=>o!==a.model&&o.visible).length,footing:a.footing,clearedPlantTriangles:a.clearedPlantTriangles,style:'shorter-leg Blender cast',fishing:a.id==='fisher'?fishing:false,rodVisible:a.rod?.visible||false,fishingBlend:a.id==='fisher'?fishingBlend:0,
      poseAtRest:[...a.rest].every(([b,q])=>b.quaternion.toArray().every((n,i)=>Math.abs(n-q.toArray()[i])<1e-7)),bounds:{min:box.min.toArray(),max:box.max.toArray()},
      camera:characterView(a.id),
      headCamera:{position:a.model.localToWorld(v(.30,a.data.nativeBounds[2][1]-.12,1.30)).toArray(),target:a.model.localToWorld(v(0,a.data.nativeBounds[2][1]-.20,0)).toArray()}};
  })};
}
