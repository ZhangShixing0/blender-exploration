import * as THREE from 'three';

// Coordinates are the imported harbor's Y-up world coordinates. Keep the old
// source geometry hidden for rollback; new framing has explicit bearing points.
export function repairPierContacts(root) {
  const V=(...a)=>new THREE.Vector3(...a), label=o=>(o.userData?.name||o.name||'').replaceAll('_',' ').toLowerCase();
  const report={hidden:[],relocated:[],stairs:[],supports:[],fingerPiles:[],propContacts:[],canopies:[]};
  const group=new THREE.Group();group.name='V337 harbor contact repairs';root.add(group);
  const material=c=>new THREE.MeshStandardMaterial({color:c,roughness:.79});
  const wood=material('#9b8a65'),end=material('#ae9b72'),frame=material('#867451'),rope=material('#c4b798'),iron=material('#56574b');
  function box(name,p,size,m=wood){
    const [w,h,d]=size,r=Math.min(.009,w*.16,h*.16,d*.16),shape=new THREE.Shape();
    shape.moveTo(-w/2+r,-d/2+r);shape.lineTo(w/2-r,-d/2+r);shape.lineTo(w/2-r,d/2-r);shape.lineTo(-w/2+r,d/2-r);shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:h-2*r,steps:1,bevelEnabled:true,bevelSize:r,bevelThickness:r,bevelSegments:2});
    geometry.translate(0,0,r-h/2);geometry.rotateX(-Math.PI/2);
    const mesh=new THREE.Mesh(geometry,m);mesh.name='V337 '+name;mesh.position.set(...p);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);if(p[1]-size[1]/2<.53)mesh.userData.needsImmersion=true;return mesh;
  }
  function beam(name,a,b,r=.045,m=frame){const delta=V(...b).sub(V(...a));const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,delta.length(),16),m);mesh.name='V337 '+name;mesh.position.copy(V(...a).add(V(...b)).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(V(0,1,0),delta.normalize());group.add(mesh);mesh.castShadow=mesh.receiveShadow=true;if(Math.min(a[1],b[1])-r<.53)mesh.userData.needsImmersion=true;return mesh;}
  function ring(name,x,y,z,r,t,m){const mesh=new THREE.Mesh(new THREE.TorusGeometry(r,t,8,32),m);mesh.name='V337 '+name;mesh.rotation.x=Math.PI/2;mesh.position.set(x,y,z);group.add(mesh);return mesh;}
  function pile(name,x,z,top,r=.065){beam(name+' piling',[x,-.96,z],[x,top,z],r);report.supports.push({name,x,z,bottom:-.96,top});}
  function shift(o,dx,dy,dz){const world=o.getWorldPosition(V(0,0,0)).add(V(dx,dy,dz));o.position.copy(o.parent.worldToLocal(world));report.relocated.push(o.name);}
  root.updateMatrixWorld(true);
  root.traverse(o=>{
    const n=label(o);
    if(/^(small landing steps|v3.7 west boardwalk|v3.7 boardwalk crate|v3.7 south finger pier rail|finger pier piling|v3.7 fish market display|v3.7 market crate)/.test(n)){
      o.visible=false;report.hidden.push(o.name);
    }
    // Stalls were authored from a base below the quay, and their props sat in
    // front of the quay without any floor. Raise the whole stall, not just legs.
    if(n.startsWith('v3.7 fish market canopy'))shift(o,0,.34,0);
    if(n.startsWith('v3.7 net mender canopy'))shift(o,0,.33,0);
    if(n.startsWith('v3.7 net mender barrel')){
      shift(o,0,.25,0);
      const p=o.getWorldPosition(V(0,0,0));
      for(const y of [1.415,1.665])ring('Barrel attached iron hoop',p.x,y,p.z,.118,.008,iron);
      report.propContacts.push({name:o.name,bottom:1.36,supportTop:1.36});
    }
    // The moved gangway piling also needs its diagonal brace reconnected.
    if(n.startsWith('v331 main pier diagonal brace')){
      const c=new THREE.Box3().setFromObject(o).getCenter(V(0,0,0));
      if(c.x<1.5){o.visible=false;report.hidden.push(o.name);}
    }
  });

  // West landing: five equal risers followed by an L-shaped top landing
  // that actually overlaps the first quay coping stone at x=-4.71.
  const low=.7775,high=1.365,rise=(high-low)/5;
  for(let i=0;i<5;i++){
    const z=2.34-i*.22,top=low+rise*(i+1);
    box('West landing stair tread',[-5.30,top-.045,z],[.86,.09,.24]);
    box('West landing closed riser',[-5.30,top-rise/2,z+.10],[.84,rise,.035],frame);
    report.stairs.push({x:-5.30,z,top,width:.86,depth:.24});
  }
  for(const x of [-5.63,-4.97])beam('West stair structural stringer',[x,.66,2.47],[x,1.25,1.31],.065);
  // Plank ends join the stone edge. The turn has no dead-end handrail.
  for(let i=0;i<7;i++)box('West landing quay connector',[-5.66+i*.176,high-.05,1.12],[.174,.10,.48]);
  for(const z of [.97,1.28])box('West landing underside bearer',[-5.13,1.235,z],[1.32,.16,.10],frame);
  for(const x of [-5.66,-4.62])for(const z of [.97,1.28])pile('West landing support',x,z,1.27,.055);
  for(const x of [-5.73,-4.87]){
    for(const i of [0,2,4]){const {z,top}=report.stairs[i];beam('West stair railing post',[x,top-.08,z],[x,top+.38,z],.024);}
    beam('West stair continuous handrail',[x,report.stairs[0].top+.36,2.34],[x,high+.36,1.46],.023);
  }

  // Both kiosks get shore-connected decks, cross-bearers and seabed piles.
  // Nothing is left balancing on the front face of the masonry wall.
  function stallDeck(name,x,z,width,depth){
    const n=Math.ceil(depth/.18),d=depth/n;
    for(let i=0;i<n;i++)box(name+' pier plank',[x,1.30,z-depth/2+d*(i+.5)],[width,.12,d-.008]);
    for(const zz of [z-depth/2+.12,z+depth/2-.12]){
      box(name+' pier cross bearer',[x,1.19,zz],[width+.05,.16,.12],frame);
      for(const xx of [x-width/2+.10,x+width/2-.10])pile(name,xx,zz,1.25,.055);
    }
    box(name+' pier front fascia',[x,1.245,z+depth/2-.02],[width,.17,.045],frame);
  }
  stallDeck('Fish market',-.90,2.28,1.52,1.88);
  stallDeck('Net mender',3.85,2.00,1.34,1.32);
  // The authored columns stop 0.06 below their roofs. Two bearing headers
  // connect all four columns to the roof/rafters without changing floor contact.
  function connectCanopy(stall){
    root.updateMatrixWorld(true);
    const prefix='v3.7 '+stall.toLowerCase()+' canopy',posts=[];let roof;
    root.traverse(o=>{
      if(!o.isMesh)return;
      const n=label(o);
      if(n===prefix+' canopy')roof=o;
      if(n.startsWith(prefix+' post'))posts.push(o);
    });
    if(!roof||posts.length!==4)throw new Error(stall+' canopy support parts changed');
    const roofBox=new THREE.Box3().setFromObject(roof),rows=new Map();
    for(const post of posts){
      const bounds=new THREE.Box3().setFromObject(post),center=bounds.getCenter(V(0,0,0)),key=center.z.toFixed(4);
      if(!rows.has(key))rows.set(key,[]);rows.get(key).push({post,bounds,center});
    }
    const result={name:stall,roofBottom:roofBox.min.y,headers:[],posts:[]};
    for(const row of rows.values()){
      if(row.length!==2)throw new Error(stall+' canopy columns are not paired');
      const left=Math.min(...row.map(p=>p.bounds.min.x))-.015,right=Math.max(...row.map(p=>p.bounds.max.x))+.015;
      const low=Math.min(...row.map(p=>p.bounds.max.y))-.006,high=roofBox.min.y+.004;
      const depth=Math.max(...row.map(p=>p.bounds.max.z-p.bounds.min.z))+.016,z=row[0].center.z;
      const header=box(stall+' canopy header',[(left+right)/2,(low+high)/2,z],[right-left,high-low,depth],row[0].post.material);
      header.name='V342 '+stall+' canopy header';header.updateWorldMatrix(true,false);
      const bearing=new THREE.Box3().setFromObject(header);
      result.headers.push({name:header.name,min:bearing.min.toArray(),max:bearing.max.toArray(),roofOverlap:bearing.max.y-roofBox.min.y});
      for(const p of row)result.posts.push({name:p.post.name,deckClearance:p.bounds.min.y-1.36,headerOverlap:p.bounds.max.y-bearing.min.y,
        capContained:p.bounds.min.x>bearing.min.x&&p.bounds.max.x<bearing.max.x&&p.bounds.min.z>bearing.min.z&&p.bounds.max.z<bearing.max.z});
    }
    report.canopies.push(result);
  }
  connectCanopy('Fish market');connectCanopy('Net mender');
  // Replace the four hovering solid cylinders with two open crates on the counter.
  for(const x of [-1.20,-.61]){
    box('Market crate bottom',[x,2.083,2.72],[.42,.026,.29],end);
    for(const z of [2.581,2.859])for(const y of [2.12,2.18])box('Market crate slat',[x,y,z],[.42,.045,.02],end);
    for(const xx of [x-.20,x+.20])box('Market crate end',[xx,2.15,2.72],[.025,.14,.29],end);
    report.propContacts.push({name:'market crate',bottom:2.07,supportTop:2.07});
  }

  // Finger pier: four pilings outside both board edges, connected underneath.
  // Radius + 15 mm gap clears the entire deck; do not drive piles through planks.
  for(const x of [2.92,4.05])for(const z of [3.16,4.24]){
    pile('Finger pier',x,z,1.47,.085);
    beam('Finger pier end cap',[x,1.47,z],[x,1.50,z],.090,end);
    for(const y of [1.34,1.385])ring('Finger pier mooring rope',x,y,z,.089,.013,rope);
    report.fingerPiles.push({x,z,radius:.085,bottom:-.96,top:1.47});
  }
  for(const x of [2.92,4.05])box('Finger pier cross bearer',[x,.965,3.7],[.14,.14,1.25],frame);
  for(const z of [3.34,4.06])box('Finger pier longitudinal support',[3.48,.995,z],[1.52,.10,.09],frame);
  beam('Main pier reconnected diagonal support',[1.20,-.56,3.83],[1.20,.97,2.905],.06);
  box('Main pier new cross bearer',[2.0,.953,3.83],[1.74,.18,.18],frame);

  root.updateMatrixWorld(true);
  return report;
}
