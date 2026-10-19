import * as THREE from 'three';

const v=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const name=o=>(o.userData?.name||o.name||'').replace(/_/g,' ').toLowerCase();
const clamp=THREE.MathUtils.clamp;
function rng(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function shown(o){for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;}

export function harborObstacles(root) {
  const rows=[];root.updateMatrixWorld(true);
  root.traverse(o=>{
    if(!o.isMesh||!shown(o)||!/piling|support|painted hull|pier|gangway|foundation|cliff|boulder|protection rock|harbor land/.test(name(o))||/rope|grain|water|foam|glow/.test(name(o)))return;
    const box=new THREE.Box3().setFromObject(o);
    if(box.min.y<1.35&&box.max.y>-.5)rows.push({name:name(o),box});
  });return rows;
}

export function createFishSchool(fish,obstacles) {
  const random=rng(33507),step=.30,cols=51,rows=11,minX=-7.5,minZ=3.25;
  const solids=obstacles.filter(o=>o.box.min.y<-.08&&o.box.max.y>-.45);
  const free=(p,margin=.19)=>p.x>=minX+margin-.19&&p.x<=7.5-margin+.19&&p.z>=minZ+margin-.19&&p.z<=6.25-margin+.19&&!solids.some(({box:b})=>p.x>b.min.x-margin&&p.x<b.max.x+margin&&p.z>b.min.z-margin&&p.z<b.max.z+margin);
  const cells=[];
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const p=v(minX+i*step,0,minZ+j*step);cells.push({p,free:free(p,.33),i,j});}
  function lineFree(a,b,margin=.33){const length=a.distanceTo(b),n=Math.max(1,Math.ceil(length/.09));for(let i=0;i<=n;i++)if(!free(a.clone().lerp(b,i/n),margin))return false;return true;}
  function closest(p){let best=0,d=Infinity;cells.forEach((c,i)=>{const dist=(c.p.x-p.x)**2+(c.p.z-p.z)**2;if(c.free&&dist<d){best=i;d=dist;}});return best;}
  function plan(start,goal) {
    const s=closest(start),g=closest(goal),open=new Set([s]),came=new Map(),cost=new Map([[s,0]]);
    while(open.size){let current=-1,score=Infinity;for(const i of open){const n=cost.get(i)+cells[i].p.distanceTo(cells[g].p);if(n<score){current=i;score=n;}}
      if(current===g){const path=[];for(let i=g;i!==undefined;i=came.get(i))path.unshift(cells[i].p.clone());
        // Simplify only where the entire segment has clearance; no spline cuts through piles.
        const smooth=[start.clone().setY(0)];let at=0;
        while(at<path.length){let last=at;for(let j=at;j<path.length;j++){if(lineFree(smooth.at(-1),path[j]))last=j;else break;}smooth.push(path[last]);at=last+1;}
        return smooth.slice(1);
      }
      open.delete(current);const c=cells[current];
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
        const x=c.i+dx,z=c.j+dz;if(x<0||x>=cols||z<0||z>=rows)continue;const next=z*cols+x;
        if(!cells[next].free||!lineFree(c.p,cells[next].p))continue;
        const value=cost.get(current)+Math.hypot(dx,dz)*step;
        if(value<(cost.get(next)??Infinity)){cost.set(next,value);came.set(next,current);open.add(next);}
      }
    }return [];
  }
  const actors=fish.map((object,i)=>{
    const position=object.position;position.copy(cells[closest(position)].p).setY(object.userData.y);object.scale.x=1;
    return {object,i,velocity:v(),path:[],state:'cruise',pause:0,replan:0,goal:null,traveled:0,collisions:0,heading:0};
  });
  function cruise(actor,time) {
    const choices=cells.filter(c=>c.free&&c.p.distanceTo(actor.object.position)>3.8&&c.p.distanceTo(actor.object.position)<10.5);
    for(let i=0;i<12&&choices.length;i++){
      const goal=choices[Math.floor(random()*choices.length)].p,path=plan(actor.object.position,goal);
      if(path.length){actor.path=path;actor.goal=goal.clone();actor.state='cruise';actor.pause=0;actor.replan=time+90;return;}
    }
  }
  function update(time,dt,food) {
    for(const a of actors){const obj=a.object,p=obj.position,data=obj.userData;
      if(data.scare?.until>time&&a.state!=='escape'){
        const away=p.clone().sub(data.scare.point).setY(0).normalize();const goal=p.clone().addScaledVector(away,2.7);
        a.path=plan(p,goal);a.state='escape';a.pause=0;a.replan=time+5;
      }else if(!(data.scare?.until>time)&&food?.until>time&&p.distanceTo(food.point)<5){
        if(a.state!=='feed'||!a.goal||a.goal.distanceTo(food.point)>.55){
          const goal=food.point.clone().add(v(Math.cos(a.i*2.4)*.23,0,Math.sin(a.i*2.4)*.23));
          a.path=plan(p,goal);a.goal=food.point.clone();a.state='feed';a.pause=0;
        }
      }else if(a.state==='feed'||time>a.replan){a.path=[];a.state='cruise';a.pause=0;}
      if(!a.path.length&&a.state!=='feed'&&time>=a.pause)cruise(a,time);
      while(a.path.length&&Math.hypot(p.x-a.path[0].x,p.z-a.path[0].z)<.11)a.path.shift();
      const target=a.path[0],desired=v();
      if(target){const delta=target.clone().sub(p).setY(0),distance=delta.length();
        const speed=(a.state==='escape'?.29:a.state==='feed'?.20:.17+.035*Math.sin(time*.32+a.i))*(reducedFactor());
        desired.copy(delta).normalize().multiplyScalar(speed*Math.min(1,distance/.35));
      }else if(a.state!=='feed'&&!a.pause){a.pause=time+1+random()*2.5;}
      a.velocity.lerp(desired,1-Math.exp(-dt*2.6));
      const next=p.clone().addScaledVector(a.velocity,dt);
      if(lineFree(p.clone().setY(0),next.clone().setY(0),.19)){a.traveled+=p.distanceTo(next);p.copy(next);}
      else {a.velocity.multiplyScalar(.2);a.path=[];a.pause=0;a.collisions++;}
      if(a.velocity.length()>.008){const targetYaw=Math.atan2(-a.velocity.z,a.velocity.x),delta=Math.atan2(Math.sin(targetYaw-a.heading),Math.cos(targetYaw-a.heading));a.heading+=delta*(1-Math.exp(-dt*4));}
      obj.rotation.y=a.heading;p.y=data.y+Math.sin(time*.48+a.i)*.035;
      obj.children[1].rotation.y=Math.sin(time*(4+a.velocity.length()*6)+a.i)*(.08+a.velocity.length()*.6);
      data.speedNow=a.velocity.length();
    }
  }
  const reducedFactor=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches?.65:1;
  return {update,inspect:()=>actors.map(a=>({position:a.object.position.toArray(),speed:a.velocity.length(),state:a.state,remaining:a.path.length,traveled:a.traveled,blocked:a.collisions,goal:a.goal?.toArray()}))};
}

const material=(color)=>new THREE.MeshStandardMaterial({color,roughness:.72});
const sphere=new THREE.SphereGeometry(1,24,16);
function ellipsoid(parent,label,position,scale,mat){const m=new THREE.Mesh(sphere,mat);m.name=label;m.position.set(...position);m.scale.set(...scale);parent.add(m);return m;}
function cylinder(parent,label,radius,length,mat,y){const m=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,12),mat);m.name=label;m.position.y=y;parent.add(m);return m;}

export { repairHarborCharacters, repairGangway } from './harbor-details.js?v=harbor342';

export function createGullFlights(root,camera) {
  const random=rng(33519),birds=[];
  root.traverse(o=>{if(/v3.15 gull flight root/.test(name(o)))birds.push({object:o,index:birds.length});});
  const white=material('#e8e6d9'),tip=material('#8c979e');
  for(const b of birds){b.object.traverse(o=>{if(/wing pivot/.test(name(o)))o.visible=false;});b.wings=[];
    for(const side of [-1,1]){const wing=new THREE.Group();wing.position.set(side*.045,0,.015);b.object.add(wing);b.wings.push(wing);
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,.065,side*.22,0,.04,side*.43,0,-.15,side*.23,0,-.085,0,0,-.09],3));g.setIndex([0,1,3,1,2,3,0,3,4]);g.computeVertexNormals();
      const mat=white.clone();mat.side=THREE.DoubleSide;wing.add(new THREE.Mesh(g,mat));
      for(let i=0;i<3;i++)ellipsoid(wing,'Wingtip feather',[side*(.34+i*.025),-.002,-.095-i*.022],[.047,.006,.017],tip);
    }
    b.pass=0;b.distance=0;b.bank=0;b.travel=0;b.teleports=0;b.visibleResets=0;
    makePass(b);b.distance=b.curve.getLength()*(.39+b.index*.09);
  }
  function makePass(b){const angle=(b.index*2.1+b.pass*1.37)+(random()-.5)*.6,d=v(Math.cos(angle),0,Math.sin(angle)),n=v(-d.z,0,d.x),offset=(random()-.5)*5;
    const points=[[-29,7.1,offset+5],[-9,8.2,offset+2],[0,10.1,offset-3],[9,8.7,offset+1],[29,8.0,offset-5]].map(([x,y,z])=>d.clone().multiplyScalar(x).addScaledVector(n,z).setY(y+(random()-.5)*1.1));
    b.curve=new THREE.CatmullRomCurve3(points);b.length=b.curve.getLength();b.distance=0;b.lastYaw=null;b.pass++;
  }
  const frustum=new THREE.Frustum(),matrix=new THREE.Matrix4();
  function update(time,dt,reduced){camera.updateMatrixWorld();frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    for(const b of birds){const speed=(.68+b.index*.08)*(1+Math.sin(time*.17+b.index)*.13)*(reduced?.65:1);b.distance+=dt*speed;b.travel+=dt*speed;
      const u=Math.min(1,b.distance/b.length),p=b.curve.getPointAt(u),t=b.curve.getTangentAt(u);
      if(b.distance>b.length)p.addScaledVector(t,b.distance-b.length);
      b.object.position.copy(p);
      const yaw=Math.atan2(t.x,t.z),pitch=-Math.asin(clamp(t.y,-1,1));
      let turn=b.lastYaw===null?0:Math.atan2(Math.sin(yaw-b.lastYaw),Math.cos(yaw-b.lastYaw));b.lastYaw=yaw;
      b.bank=THREE.MathUtils.damp(b.bank,clamp(-turn/Math.max(dt,.001)*.8,-.35,.35),2,dt);
      b.object.rotation.set(pitch,yaw,b.bank,'YXZ');
      const burst=((time+b.index*4.3)%(10.7+b.index*1.3))<2.1;
      const flap=burst&&!reduced?Math.sin(time*7.5+b.index)*.28:.035*Math.sin(time*.8+b.index);
      b.wings[0].rotation.z=-flap-.05;b.wings[1].rotation.z=flap+.05;
      if(b.distance>b.length&&!frustum.intersectsSphere(new THREE.Sphere(p,.7))){
        // The departing bird AND the next entry must be outside the current camera.
        // Move a distant entry farther out if the user has zoomed all the way out.
        makePass(b);
        for(let attempt=0;attempt<8&&frustum.intersectsSphere(new THREE.Sphere(b.curve.points[0],.7));attempt++){
          b.curve.points[0].x*=1.6;b.curve.points[0].z*=1.6;
        }
        b.curve.updateArcLengths();b.length=b.curve.getLength();b.teleports++;
        if(frustum.intersectsSphere(new THREE.Sphere(b.curve.points[0],.7)))b.visibleResets++;
      }
    }
  }
  return {update,inspect:()=>birds.map(b=>({position:b.object.position.toArray(),rotation:b.object.rotation.toArray().slice(0,3),travel:b.travel,pass:b.pass,resets:b.teleports,visibleResets:b.visibleResets,wing:b.wings[0].rotation.z}))};
}

// SAT against the whole oriented skiff footprint, including a 12 cm safety gap.
export function boatClearance(point,yaw,obstacles,margin=.12,footprint={x:.30,z:.57,offset:.08,minY:.32,maxY:1.11}) {
  const a={x:Math.cos(yaw),z:-Math.sin(yaw)},b={x:Math.sin(yaw),z:Math.cos(yaw)};
  const center={x:point.x+b.x*footprint.offset,z:point.z+b.z*footprint.offset},hx=footprint.x+margin,hz=footprint.z+margin;
  const hits=[];
  for(const o of obstacles){const box=o.box;if(box.max.y<footprint.minY||box.min.y>footprint.maxY)continue;
    const cx=(box.min.x+box.max.x)/2,cz=(box.min.z+box.max.z)/2,ex=(box.max.x-box.min.x)/2,ez=(box.max.z-box.min.z)/2;
    const dx=cx-center.x,dz=cz-center.z;
    const separated=[a,b,{x:1,z:0},{x:0,z:1}].some(axis=>Math.abs(dx*axis.x+dz*axis.z)>hx*Math.abs(a.x*axis.x+a.z*axis.z)+hz*Math.abs(b.x*axis.x+b.z*axis.z)+ex*Math.abs(axis.x)+ez*Math.abs(axis.z));
    if(!separated)hits.push(o.name);
  }return hits;
}
