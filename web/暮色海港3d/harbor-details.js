import * as THREE from 'three';
import { repairPierContacts } from './harbor-contacts.js?v=harbor342';

const v=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const label=o=>(o.userData?.name||o.name||'').replaceAll('_',' ').toLowerCase();
const mat=(color,roughness=.72,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
const sphere=new THREE.SphereGeometry(1,24,18);
function oval(parent,name,p,s,m){const o=new THREE.Mesh(sphere,m);o.name=name;o.position.set(...p);o.scale.set(...s);parent.add(o);return o;}
function tube(parent,name,points,r,m){const c=new THREE.CatmullRomCurve3(points.map(p=>Array.isArray(p)?v(...p):p));const o=new THREE.Mesh(new THREE.TubeGeometry(c,Math.max(16,points.length*4),r,8,false),m);o.name=name;parent.add(o);return o;}
function rod(parent,name,a,b,r,m){const dir=b.clone().sub(a),o=new THREE.Mesh(new THREE.CylinderGeometry(r,r,dir.length(),16),m);o.name=name;o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(v(0,1,0),dir.normalize());parent.add(o);return o;}
export { repairHarborCharacters } from './harbor-cast.js?v=harbor340';

export function repairGangway(root){
  const moved=[],hidden=[];root.updateMatrixWorld(true);
  root.traverse(o=>{
    const n=label(o);
    if(/v3.9 gangway (rail|rope)/.test(n)){o.visible=false;hidden.push(o.name);}
    if(o.isMesh&&/^(pier piling|piling end grain|rope on piling)/.test(n)){
      const box=new THREE.Box3().setFromObject(o),center=box.getCenter(v());
      if(Math.abs(center.x-1.2)<.03&&Math.abs(center.z-4.4)<.035){const world=o.getWorldPosition(v());world.z-=.57;o.position.copy(o.parent.worldToLocal(world));moved.push(o.name);}
    }
  });
  const group=new THREE.Group();group.name='V336 anchored timber gangway rails';root.add(group);
  const wood=mat('#9b8158'),cap=mat('#b89f73'),rope=mat('#c3b28e'),metal=mat('#756b54',.6,.25),posts=[];
  const deck=x=>.75+.33*(x+.28)/1.5+.058;
  for(const z of [4.055,4.645]){
    for(const x of [-.26,.45,1.16]){
      const y=deck(x);rod(group,'Gangway railing post',v(x,y-.07,z),v(x,y+.43,z),.029,wood);posts.push({x,z,base:y-.07,deck:y,top:y+.43});
      oval(group,'Railing post cap',[x,y+.435,z],[.034,.014,.034],cap);
      for(const yy of [y+.035,y+.13])oval(group,'Post fastening',[x,yy,z+.030],[.009,.009,.004],metal);
    }
    rod(group,'Continuous attached wooden handrail',v(-.26,deck(-.26)+.40,z),v(1.16,deck(1.16)+.40,z),.024,wood);
    for(const [a,b] of [[-.26,.45],[.45,1.16]])tube(group,'Tied lower rope',[[a,deck(a)+.22,z],[(a+b)/2,deck((a+b)/2)+.19,z],[b,deck(b)+.22,z]],.010,rope);
  }
  root.updateMatrixWorld(true);
  return {moved,hidden,posts,contacts:repairPierContacts(root)};
}
