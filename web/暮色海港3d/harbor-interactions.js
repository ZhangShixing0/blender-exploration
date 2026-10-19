import * as THREE from 'three';
import { harborObstacles, createFishSchool, repairHarborCharacters, repairGangway, createGullFlights, boatClearance } from './harbor-life.js?v=harbor342';

// Shared height field: the same wave displaces vertices and changes surface normals.
export const RIPPLE_GLSL = `
uniform vec4 uRipples[16];
float touchWave(vec2 p, float time) {
  float height = 0.0;
  for (int i=0; i<16; i++) {
    vec4 r=uRipples[i]; float age=time-r.z;
    if (r.w>0.0 && age>=0.0 && age<6.0) {
      float d=length(p-r.xy), front=d-age*1.05;
      float envelope=exp(-front*front*2.8)*pow(1.0-age/6.0,2.0);
      height+=sin(front*12.0)*envelope*r.w;
    }
  }
  return height;
}`;

const label = object => (object.userData?.name || object.name || '').replace(/_/g, ' ').toLowerCase();
const clamp = THREE.MathUtils.clamp;
const v = (x,y,z) => new THREE.Vector3(x,y,z);
const visible = object => { for(let p=object;p;p=p.parent) if(!p.visible)return false; return true; };

export async function createHarborInteractions({ scene, harbor, camera, renderer, canvas, orbit, fish, visitingBoat,
  waterMaterial, waterLevel, lighthouse, moveToView, cancelCameraMotion, restoreLighting, isWaterVisible, isNight, reducedMotion }) {
  let time=0, mode='look', rain=false, rainNext=0, nextRipple=0, lastWaterSound=-10;
  let lastFood=-10, food=null, waveUntil=-10, lastPointer=null, pointerBlocked=false;
  let guide=null, postcardURL=null, lastToast='', toastUntil=0;
  const pointers=new Set(), pointerNDC=new THREE.Vector2(), raycaster=new THREE.Raycaster();
  raycaster.layers.enable(1);
  const plane=new THREE.Plane(v(0,1,0),-waterLevel), tmp=v(0,0,0);
  const rippleData=Array.from({length:16},()=>new THREE.Vector4(0,0,-100,0));
  waterMaterial.uniforms.uRipples={value:rippleData};
  const stats={waterTaps:0,foodDrops:0,boatTouches:0,waves:0,arrivals:0,photos:0,landRejects:0,dragRejects:0};
  const $=s=>document.querySelector(s);
  // Automatic escort occupies the existing bottom navigation space, never the scenery.
  let guideFinishedAt=-1;
  const effect=(kind,enabled)=>window.dispatchEvent(new CustomEvent('harbor-effect',{detail:{kind,enabled}}));
  function toast(text) {
    lastToast=text;toastUntil=time+4;
    $('#explore-status').textContent=text;
    $('#scene-feedback').textContent=text;$('#scene-feedback').hidden=false;
  }
  const characters=await repairHarborCharacters(harbor), gangway=repairGangway(harbor), obstacles=harborObstacles(harbor);
  const school=createFishSchool(fish,obstacles), gulls=createGullFlights(harbor,camera);
  const objects=[],boats=[],people=[];
  harbor.updateMatrixWorld(true);
  harbor.traverse(object=>{
    const name=label(object);
    if(/boat editable root/.test(name)) {
      const boat={object,position:object.position.clone(),quaternion:object.quaternion.clone(),impulse:-100};
      boats.push(boat);object.userData.interactiveKind='boat';
    }
    if(/^(lighthouse keeper|working fisher|cafe visitor) root$/.test(name)) {
      people.push(object);object.userData.interactiveKind='person';
    }
    if(object.isMesh && visible(object)) {
      const box=new THREE.Box3().setFromObject(object);
      if(box.max.y>waterLevel+.06 && !/water|beam|haze|halo|seabed|exposed.*cut/.test(name))objects.push({object,box:object.isSkinnedMesh?box.expandByScalar(.45):box});
    }
  });
  // Mark only the lighthouse itself, not the keeper or nearby ground.
  objects.forEach(({object})=>{
    if(/lighthouse|^tower /.test(label(object)) && !/keeper|ground|root/.test(label(object)))object.userData.interactiveKind='lighthouse';
  });
  const tower=objects.find(item=>label(item.object).includes('tapered ivory lighthouse'));
  const towerBounds=tower?.box.clone().expandByScalar(.4);
  if(towerBounds)towerBounds.max.y=lighthouse[0].position.y+1.2;
  function kindOf(object) {
    for(let p=object;p;p=p.parent)if(p.userData.interactiveKind)return {kind:p.userData.interactiveKind,object:p};
    return null;
  }
  function project(point) {
    const p=point.clone().project(camera),r=canvas.getBoundingClientRect();
    return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
  }
  function pick(x,y) {
    const rect=canvas.getBoundingClientRect();
    pointerNDC.set((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2);
    raycaster.setFromCamera(pointerNDC,camera);
    const point=raycaster.ray.intersectPlane(plane,v(0,0,0));
    const waterDistance=point?point.distanceTo(raycaster.ray.origin):Infinity;
    const candidates=objects.filter(item=>visible(item.object)&&raycaster.ray.intersectsBox(item.box)).map(item=>item.object);
    // Bounds are broad phase only; triangle hits stop a tap passing through a pier or island.
    const hit=raycaster.intersectObjects(candidates,false)[0];
    if(hit && hit.distance<waterDistance-.015)return {type:'solid',point:hit.point,name:label(hit.object),
      ...(kindOf(hit.object)||(towerBounds?.containsPoint(hit.point)?{kind:'lighthouse'}:{}))};
    if(!point || Math.abs(point.x)>8.72 || Math.abs(point.z)>6.72 || !isWaterVisible())return null;
    return {type:'water',point};
  }
  function ripple(point,strength=.075,react=true) {
    rippleData[nextRipple++%16].set(point.x,point.z,time,reducedMotion.matches?strength*.4:strength);
    if(react) {
      fish.forEach(actor=>{
        if(actor.position.distanceTo(point)<3.2)actor.userData.scare={point:point.clone(),until:time+4};
      });
      boats.forEach(boat=>{if(boat.object.position.distanceTo(point)<4)boat.impulse=time;});
    }
  }
  const foodGroup=new THREE.Group();scene.add(foodGroup);
  const foodGeometry=new THREE.IcosahedronGeometry(.025,0);
  const foodMaterial=new THREE.MeshBasicMaterial({color:'#d6ac64',transparent:true});
  for(let i=0;i<7;i++)foodGroup.add(new THREE.Mesh(foodGeometry,foodMaterial));
  foodGroup.visible=false;
  function feed(point) {
    if(!isWaterVisible()){toast('先在画面设置里打开「海水与游鱼」。');return;}
    if(point.z<3.65 || point.z>6.3 || Math.abs(point.x)>7.3) {
      toast('在码头前方的浅水里投一点，鱼儿更容易找到。');return;
    }
    if(time-lastFood<1.5){toast('慢一点，等鱼儿游过来。');return;}
    lastFood=time;food={point:point.clone(),until:time+14};stats.foodDrops++;
    foodGroup.visible=true;foodMaterial.opacity=1;
    foodGroup.children.forEach((mesh,i)=>mesh.position.set(point.x+Math.cos(i*2.4)*.15,waterLevel-.015,point.z+Math.sin(i*2.4)*.15));
    fish.forEach(actor=>delete actor.userData.scare);
    ripple(point,.035,false);effect('water');toast('撒下一点鱼食，等附近的鱼儿慢慢靠近。');
  }
  function greet(id='keeper') {waveUntil=time+4.6;characters.greet(id,time);stats.waves++;toast(({keeper:'守塔人',visitor:'旅人',fisher:'渔夫'}[id]||'邻居')+'向你挥了挥手。');}
  function touchBoat(object) {
    const boat=boats.find(item=>item.object===object)||boats[0];
    if(boat)boat.impulse=time;stats.boatTouches++;effect('horn');toast('船轻轻晃了晃，缆绳还系在码头上。');
  }
  function setMode(value) {
    mode=value;
    if(mode==='stir') {
      cancelCameraMotion();
      const held=camera.position.clone(),target=orbit.target.clone(),damping=orbit.enableDamping;
      orbit.enableDamping=false;orbit.update();
      camera.position.copy(held);orbit.target.copy(target);orbit.enableDamping=damping;orbit.update();
    }
    document.querySelectorAll('[data-explore-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.exploreMode===mode)));
    // In water mode a one-finger stroke stirs. Two fingers still orbit/zoom.
    orbit.mouseButtons.LEFT=mode==='stir'?null:THREE.MOUSE.ROTATE;
    orbit.touches.ONE=mode==='stir'?null:THREE.TOUCH.ROTATE;
    canvas.style.cursor=mode==='look'?'grab':'crosshair';
    $('#interaction-hint').textContent=mode==='stir'?'划动水面 · 双指环顾 / 缩放':mode==='feed'?'轻点前方浅水投食 · 拖动环顾':'轻点水面、人物或船 · 拖动环顾';
  }
  function activate(hit) {
    if(!hit)return;
    stats.lastHit=hit.name||hit.type;
    if(hit.type==='solid') {
      if(hit.kind==='boat')touchBoat(hit.object);
      else if(hit.kind==='person'){if(hit.object.userData.castRole==='fisher')toast(characters.toggleFishing()?'渔夫拿起了钓竿。再点一下，他会收起钓竿。':'渔夫收起了钓竿。');else greet(hit.object.userData.castRole);}
      else if(hit.kind==='lighthouse')startGuide();
      else stats.landRejects++;
      return;
    }
    if(mode==='feed')feed(hit.point);
    else {ripple(hit.point);stats.waterTaps++;if(time-lastWaterSound>.25){effect('water');lastWaterSound=time;}}
  }
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    cancelCameraMotion();
    pointers.add(event.pointerId);
    if(pointers.size>1){pointerBlocked=true;lastPointer=null;return;}
    pointerBlocked=false;
    lastPointer={id:event.pointerId,x:event.clientX,y:event.clientY,at:performance.now(),moved:false,lastStir:-100};
  });
  canvas.addEventListener('pointermove',event=>{
    if(!lastPointer || pointerBlocked || event.pointerId!==lastPointer.id)return;
    const distance=Math.hypot(event.clientX-lastPointer.x,event.clientY-lastPointer.y);
    if(distance>7)lastPointer.moved=true;
    if(mode==='stir'&&lastPointer.moved&&time-lastPointer.lastStir>.13) {
      const hit=pick(event.clientX,event.clientY);
      if(hit?.type==='water'){activate(hit);lastPointer.lastStir=time;}
    }
  });
  function endPointer(event,cancel=false) {
    const previous=lastPointer;pointers.delete(event.pointerId);
    if(!cancel&&!pointerBlocked&&previous?.id===event.pointerId) {
      if(!previous.moved&&performance.now()-previous.at<750)activate(pick(event.clientX,event.clientY));
      else if(previous.moved&&mode!=='stir')stats.dragRejects++;
    }
    if(event.pointerId===previous?.id)lastPointer=null;
    if(!pointers.size)pointerBlocked=false;
  }
  window.addEventListener('pointerup',event=>endPointer(event));
  window.addEventListener('pointercancel',event=>endPointer(event,true));
  window.addEventListener('blur',()=>{pointers.clear();lastPointer=null;pointerBlocked=false;});

  // A small visiting skiff stays in the open foreground channel. Existing moored boats stay tied.
  const guest=visitingBoat;guest.name='Blender pilot launch v336';guest.visible=false;scene.add(guest);
  const boatBox=new THREE.Box3().setFromObject(guest),boatSize=boatBox.getSize(v(0,0,0));
  const footprint={x:boatSize.x/2,z:boatSize.z/2,offset:(boatBox.min.z+boatBox.max.z)/2,minY:waterLevel+boatBox.min.y-.02,maxY:waterLevel+boatBox.max.y+.02};
  const checkBoat=(p,yaw)=>boatClearance(p,yaw,obstacles,.12,footprint);
  const route=new THREE.CatmullRomCurve3([v(-7,waterLevel,6.2),v(-4.5,waterLevel,6.2),v(-2.3,waterLevel,6.2),v(-.3,waterLevel,6.2),v(.8,waterLevel,5.95),v(1.3,waterLevel,5.65),v(2.1,waterLevel,5.65)]);
  const length=route.getLength(), routeAudit=[];
  for(let i=0;i<=600;i++){
    const p=route.getPointAt(i/600),t=route.getTangentAt(i/600),hits=checkBoat(p,Math.atan2(t.x,t.z));
    if(hits.length)routeAudit.push({u:i/600,hits});
  }
  function startGuide() {
    if(!isWaterVisible()){toast('先在画面设置里打开「海水与游鱼」。');return;}
    if(guide?.active){stopGuide();return;}
    guide={active:true,progress:0,aligned:true,wakeAt:0,speed:0,blocked:[],trackingError:0};guideFinishedAt=-1;
    guest.visible=true;guest.position.copy(route.getPointAt(0));
    const tangent=route.getTangentAt(0);guest.rotation.set(0,Math.atan2(tangent.x,tangent.z),0);
    setMode('look');$('#guide-status').hidden=false;$('.view-nav').hidden=true;$('#scene-feedback').hidden=true;
    $('#guide-progress').textContent='灯塔正在接船 · 0%';$('#guide-boat').setAttribute('aria-pressed','true');
    window.dispatchEvent(new Event('harbor-close-panel'));
  }
  function stopGuide() {
    if(guide)guide.active=false;
    guest.visible=false;guideFinishedAt=-1;$('#guide-status').hidden=true;$('.view-nav').hidden=false;
    $('#guide-boat').setAttribute('aria-pressed','false');restoreLighting();
  }
  function updateGuide(dt) {
    if(guideFinishedAt>0&&time>guideFinishedAt){$('#guide-status').hidden=true;$('.view-nav').hidden=false;guideFinishedAt=-1;}
    if(!guide?.active)return;
    const remaining=(1-guide.progress)*length;
    guide.speed=THREE.MathUtils.damp(guide.speed,Math.min(.30,Math.sqrt(Math.max(0,remaining)*.075)),3,dt);
    const next=Math.min(1,guide.progress+dt*guide.speed/length),p=route.getPointAt(next),t=route.getTangentAt(next);
    guide.blocked=checkBoat(p,Math.atan2(t.x,t.z));
    if(!guide.blocked.length)guide.progress=remaining<.012?1:next;
    else guide.speed=0;
    guest.position.copy(route.getPointAt(guide.progress));guest.position.y+=Math.sin(time*1.3)*.012;
    const tangent=route.getTangentAt(guide.progress);guest.rotation.set(0,Math.atan2(tangent.x,tangent.z),Math.sin(time*1.1)*.018);
    const source=lighthouse[0].position,target=guest.position.clone().add(v(0,.24,0));
    lighthouse[0].target.position.copy(target);
    lighthouse[1].target.position.copy(source).sub(target.clone().sub(source));
    lighthouse[1].target.position.y=source.y-.4;
    lighthouse.forEach(light=>{light.intensity=isNight()?9:2;light.beamMesh.visible=true;light.beamMesh.material.opacity=isNight()?.28:.16;});
    guide.trackingError=lighthouse[0].target.position.distanceTo(target);
    if(time-guide.wakeAt>.6){ripple(guest.position,.018,false);guide.wakeAt=time;}
    const message=guide.blocked.length?'小船已在障碍前停稳':`灯塔正在接船 · ${Math.round(guide.progress*100)}%`;
    if($('#guide-progress').textContent!==message)$('#guide-progress').textContent=message;
    if(guide.progress===1){guide.active=false;guide.speed=0;stats.arrivals++;effect('horn');$('#guide-progress').textContent='小船已平安到港';guideFinishedAt=time+4;$('#guide-boat').setAttribute('aria-pressed','false');restoreLighting();}
  }

  const rainPositions=new Float32Array(180*3);
  for(let i=0;i<180;i++){rainPositions[i*3]=(Math.random()-.5)*17;rainPositions[i*3+1]=1+Math.random()*10;rainPositions[i*3+2]=(Math.random()-.5)*13;}
  const rainGeometry=new THREE.BufferGeometry();rainGeometry.setAttribute('position',new THREE.BufferAttribute(rainPositions,3));
  const rainMesh=new THREE.Points(rainGeometry,new THREE.PointsMaterial({color:'#c1dbe2',size:.035,transparent:true,opacity:.6,depthWrite:false}));
  rainMesh.visible=false;scene.add(rainMesh);
  function toggleRain() {
    rain=!rain;rainMesh.visible=rain&&!reducedMotion.matches;effect('rain',rain);
    $('#rain-toggle').setAttribute('aria-pressed',String(rain));toast(rain?'下起了小雨。开启声音，还能听见雨落在海上。':'雨停了，海港慢慢安静下来。');
  }
  async function photograph() {
    const button=$('#take-photo');button.disabled=true;
    try {
      renderer.render(scene,camera);
      const card=document.createElement('canvas');card.width=renderer.domElement.width;card.height=renderer.domElement.height;
      const context=card.getContext('2d');context.drawImage(renderer.domElement,0,0);
      const scale=card.width/window.innerWidth;
      context.fillStyle=isNight()?'#e8eee8':'#294a48';context.font=`${22*scale}px KaiTi, serif`;
      context.fillText('暮色海港',28*scale,card.height-34*scale);
      context.font=`${11*scale}px sans-serif`;context.fillText(`${isNight()?'灯火守候':'海风很轻'} · ${new Date().toLocaleDateString('zh-CN')}`,28*scale,card.height-15*scale);
      const blob=await new Promise(resolve=>card.toBlob(resolve,'image/png'));
      if(!blob)throw new Error('Empty postcard');
      if(postcardURL)URL.revokeObjectURL(postcardURL);
      postcardURL=URL.createObjectURL(blob);$('#postcard-image').src=postcardURL;
      $('#download-postcard').href=postcardURL;$('#download-postcard').download='暮色海港-明信片.png';
      $('#postcard-dialog').showModal();stats.photos++;
    }catch(error){console.error(error);toast('照片暂时没保存下来，请再拍一次。');}
    finally{button.disabled=false;}
  }
  document.querySelectorAll('[data-explore-mode]').forEach(button=>button.addEventListener('click',()=>{
    if(guide?.active)stopGuide();setMode(button.dataset.exploreMode);
  }));
  $('#try-ripple').addEventListener('click',()=>{ripple(v(-1,waterLevel,5.5));stats.waterTaps++;effect('water');toast('水波散开了。也可以直接轻点海面。');});
  $('#feed-nearby').addEventListener('click',()=>feed(v(-1,waterLevel,5.5)));
  $('#greet-keeper').addEventListener('click',()=>{moveToView('keeper');window.dispatchEvent(new Event('harbor-close-panel'));greet();});
  document.querySelectorAll('[data-character-view]').forEach(button=>button.addEventListener('click',()=>{
    moveToView(button.dataset.characterView);window.dispatchEvent(new Event('harbor-close-panel'));
    toast(button.dataset.characterView==='fisher'?'点一下渔夫，他会拿起钓竿。':'点一下他，打个招呼。');
  }));
  $('#touch-boat').addEventListener('click',()=>touchBoat(boats[0]?.object));
  $('#guide-boat').addEventListener('click',startGuide);
  $('#stop-guide').addEventListener('click',stopGuide);
  $('#rain-toggle').addEventListener('click',toggleRain);
  $('#take-photo').addEventListener('click',photograph);
  $('#close-postcard').addEventListener('click',()=>$('#postcard-dialog').close());
  $('#postcard-dialog').addEventListener('click',event=>{if(event.target===$('#postcard-dialog'))$('#postcard-dialog').close();});
  $('#quiet-harbor').addEventListener('click',()=>{
    setMode('look');if(rain)toggleRain();stopGuide();food=null;foodGroup.visible=false;
    rippleData.forEach(r=>r.w=0);waveUntil=-10;characters.stopWaving();characters.stopFishing();fish.forEach(a=>delete a.userData.scare);
    boats.forEach(b=>b.impulse=-100);toast('收起小互动，继续安静看海。');
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&mode!=='look')setMode('look');});
  document.querySelectorAll('[data-scene-action]').forEach(button=>{
    button.disabled=false;
    button.addEventListener('click',()=>{if(innerWidth<700)window.dispatchEvent(new Event('harbor-close-panel'));});
  });
  setMode('look');

  function update(elapsed,dt) {
    time=elapsed;
    rainMesh.visible=rain&&!reducedMotion.matches;
    if(guide?.active&&!isWaterVisible())stopGuide();
    if(time>toastUntil&&!$('#scene-feedback').hidden)$('#scene-feedback').hidden=true;
    if(isWaterVisible())school.update(time,dt,food);
    gulls.update(time,dt,reducedMotion.matches);
    if(food) {
      foodGroup.visible=isWaterVisible()&&food.until>time;
      foodMaterial.opacity=clamp((food.until-time)/3,0,1);
      foodGroup.children.forEach((mesh,i)=>mesh.position.y=waterLevel-.015-Math.max(0,time-lastFood-3)*.012+Math.sin(time+i)*.006);
      if(food.until<time)food=null;
    }
    boats.forEach((boat,i)=>{
      const age=time-boat.impulse,amplitude=age>=0&&age<5?Math.exp(-age*.8):0;
      const motion=reducedMotion.matches?.25:1;
      boat.object.position.copy(boat.position);boat.object.position.y+=Math.sin(time*1.3+i)*.004+Math.sin(age*3.5)*amplitude*.025*motion;
      boat.object.quaternion.copy(boat.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(v(0,0,1),Math.sin(age*3)*amplitude*.035*motion));
    });
    characters.update(time,waveUntil,reducedMotion.matches);
    updateGuide(dt);
    if(rain&&!reducedMotion.matches) {
      for(let i=0;i<180;i++){rainPositions[i*3+1]-=dt*3.5;if(rainPositions[i*3+1]<waterLevel)rainPositions[i*3+1]=10;}
      rainGeometry.attributes.position.needsUpdate=true;
      if(time>rainNext&&isWaterVisible()){ripple(v(-7+Math.random()*14,waterLevel,4+Math.random()*2),.018,false);rainNext=time+.35;}
    }
  }
  const inspect=()=>({mode,rain,stats:{...stats},activeRipples:rippleData.filter(r=>r.w>0&&time-r.z<6).length,
    ripples:rippleData.filter(r=>r.w>0&&time-r.z<6).map(r=>r.toArray()),food:food?{point:food.point.toArray(),remaining:food.until-time}:null,
    fish:school.inspect().map((a,i)=>({...a,scared:fish[i].userData.scare?.until>time})),
    gulls:gulls.inspect(),characters:characters.inspect(),routeAudit,obstacleCount:obstacles.length,gangway,boatModel:{name:guest.name,size:boatSize.toArray(),footprint,meshes:guest.children.length},
    beams:lighthouse.map(l=>({visible:l.beamMesh.visible,opacity:l.beamMesh.material.opacity,intensity:l.intensity})),
    boats:boats.map(b=>({name:label(b.object),position:b.object.position.toArray(),angle:b.object.quaternion.angleTo(b.quaternion)})),
    waving:characters.isWaving(time),pivotCount:characters.actors.length*3,guide:guide?{...guide,boat:guest.position.toArray(),yaw:guest.rotation.y,clearance:checkBoat(guest.position,guest.rotation.y)}:null,lastToast,
    screen:{water:project(v(-1,waterLevel,5.5)),land:project(v(1.75,6.5,-3.9)),boat:project(boats[0]?.object.position||v(5,1,4)),guest:project(guest.position)},
    postcard:postcardURL?{width:$('#postcard-image').naturalWidth,height:$('#postcard-image').naturalHeight}:null});
  return {update,inspect,qaGreet:greet,characterView:characters.characterView,qaStep(seconds,follow=false){for(let i=0;i<Math.round(seconds*30);i++){update(time+1/30,1/30);}return time;},isGuiding:()=>!!guide?.active};
}
