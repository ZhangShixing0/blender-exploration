import * as THREE from 'three';

// Small, soft collectible figures: roughly 2.4 heads tall. Clothes follow the
// body surface; both sleeves are continuous meshes with shoulder/elbow skinning.
const v=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const label=o=>(o.userData?.name||o.name||'').replaceAll('_',' ').toLowerCase();
const material=(color,roughness=.82,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
const sphere=new THREE.SphereGeometry(1,48,32);
function oval(parent,name,p,scale,mat){const o=new THREE.Mesh(sphere,mat);o.name=name;o.position.set(...p);o.scale.set(...scale);parent.add(o);return o;}
function tube(parent,name,points,r,mat){const curve=new THREE.CatmullRomCurve3(points.map(p=>Array.isArray(p)?v(...p):p));const o=new THREE.Mesh(new THREE.TubeGeometry(curve,32,r,8,false),mat);o.name=name;parent.add(o);return o;}
function profileValue(profile,y){for(let i=0;i<profile.length-1;i++){const a=profile[i],b=profile[i+1];if(y<=b[0]){const t=THREE.MathUtils.clamp((y-a[0])/(b[0]-a[0]),0,1);return [THREE.MathUtils.lerp(a[1],b[1],t),THREE.MathUtils.lerp(a[2],b[2],t),THREE.MathUtils.lerp(a[3]||0,b[3]||0,t)];}}return profile.at(-1).slice(1);}
function smoothProfile(points){const curve=new THREE.CatmullRomCurve3(points.map(p=>v(p[1],p[0],p[2])),false,'centripetal');return curve.getPoints(64).map(p=>[p.y,Math.max(.001,p.x),Math.max(.001,p.z)]);}
function geometry(profile,segments=40){
  const vertices=[],indices=[];
  for(const [y,rx,rz,offset=0] of profile)for(let j=0;j<segments;j++){const a=j/segments*Math.PI*2;vertices.push(rx*Math.sin(a),y,rz*Math.cos(a)+offset);}
  for(let i=0;i<profile.length-1;i++)for(let j=0;j<segments;j++){const a=i*segments+j,b=i*segments+(j+1)%segments,c=b+segments,d=a+segments;indices.push(a,b,d,b,c,d);}
  for(let j=1;j<segments-1;j++){indices.push(0,j+1,j);const a=(profile.length-1)*segments;indices.push(a,a+j,a+j+1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
function shaped(parent,name,profile,mat,p=[0,0,0],smooth=true){const o=new THREE.Mesh(geometry(smooth?smoothProfile(profile):profile),mat);o.name=name;o.position.set(...p);parent.add(o);return o;}
function patch(parent,name,outline,surface,mat,offset=.003){
  const contour=outline.map(([x,y])=>new THREE.Vector2(x,y)),triangles=THREE.ShapeUtils.triangulateShape(contour,[]),coords=[],normals=[];
  const emit=(...points)=>{for(const p of points){const e=.0002,n=v(-(surface(p.x+e,p.y)-surface(p.x-e,p.y))/(2*e),-(surface(p.x,p.y+e)-surface(p.x,p.y-e))/(2*e),1).normalize();coords.push(p.x,p.y,surface(p.x,p.y)+offset);normals.push(n.x,n.y,n.z);}};
  for(const ids of triangles){const [a,b,c]=ids.map(i=>contour[i]),at=(i,j)=>a.clone().addScaledVector(b.clone().sub(a),i/10).addScaledVector(c.clone().sub(a),j/10);
    for(let i=0;i<10;i++)for(let j=0;j<10-i;j++){emit(at(i,j),at(i+1,j),at(i,j+1));if(i+j<9)emit(at(i+1,j),at(i+1,j+1),at(i,j+1));}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(coords,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));const o=new THREE.Mesh(g,mat);o.name=name;parent.add(o);return o;
}

export function repairHarborCharacters(root){
  const specs=[
    {id:'keeper',root:'lighthouse keeper root',coat:'#527184',hat:'#e9ddbd',hair:'#77786b',pants:'#415e6c',width:.158},
    {id:'fisher',root:'working fisher root',coat:'#d9bc83',hat:'#c68c61',hair:'#705342',pants:'#63888a',width:.168},
    {id:'visitor',root:'cafe visitor root',coat:'#88a89a',hat:'#e3cfa2',hair:'#715642',pants:'#698580',width:.161},
  ];
  const actors=[],ground=[];root.updateMatrixWorld(true);
  root.traverse(o=>{if(o.isMesh&&/^(pier individual deck plank|hand cut paving slab|upper turf cap|cafe waterside terrace|lower harbor land)/.test(label(o)))ground.push(o);});
  for(const spec of specs){
    const {id,width}=spec;let person;root.traverse(o=>{if(label(o)===spec.root)person=o;});if(!person)continue;
    person.children.forEach(o=>o.visible=false);
    const model=new THREE.Group();model.name=`V338 ${id} little harbor character`;person.add(model);
    const coat=material(spec.coat),pants=material(spec.pants),hat=material(spec.hat),skin=material('#e8c8a7'),hair=material(spec.hair),cream=material('#eee4ce');
    const ink=material('#3f403a',.38),brass=material('#b49a63',.5,.25),boot=material(id==='visitor'?'#c1b89b':'#4c6669'),sole=material('#65716c');
    const torsoProfile=smoothProfile([[.19,.074,.067],[.205,.108,.088],[.25,.132,.105],[.31,.137,.106],[.37,.128,.097],[.415,.109,.081],[.443,.073,.058],[.462,.038,.033]]);
    shaped(model,'Soft rounded coat',torsoProfile,coat,[0,0,0],false);
    const front=(x,y)=>{const [rx,rz]=profileValue(torsoProfile,y);return rz*Math.sqrt(Math.max(.01,1-(x/rx)**2));};
    const cloth=(name,outline,mat,offset=.003)=>patch(model,name,outline,front,mat,offset);
    if(id==='fisher'){
      cloth('Rounded dungaree bib',[[-.058,.39],[.058,.39],[.084,.238],[.068,.218],[-.068,.218],[-.084,.238]],pants);
      const stitch=material('#a4bcb3');
      for(const side of [-1,1]){
        tube(model,'Dungaree shoulder strap',[[side*.064,.383,front(side*.064,.383)+.006],[side*.072,.42,front(side*.072,.42)+.005],[side*.058,.446,front(side*.058,.446)+.004]],.009,pants);
        oval(model,'Bib brass button',[side*.057,.381,front(side*.057,.381)+.008],[.007,.007,.003],brass);
      }
      cloth('Rounded bib pocket',[[-.033,.315],[.033,.315],[.033,.281],[.022,.272],[-.022,.272],[-.033,.281]],material('#719696'),.006);
      tube(model,'Pocket stitched edge',[[-.031,.308,front(-.031,.308)+.010],[-.03,.282,front(-.03,.282)+.01],[0,.275,front(0,.275)+.010],[.03,.282,front(.03,.282)+.01],[.031,.308,front(.031,.308)+.01]],.0012,stitch);
      for(const y of [.412,.432])cloth('Mariner shirt stripe',[[-.037,y],[.037,y],[.037,y+.007],[-.037,y+.007]],cream);
    }else{
      // A small rounded knitted neck replaces the large pointed white lapels.
      shaped(model,'Soft knitted neckline',[[.439,.048,.040],[.447,.054,.046],[.457,.046,.038],[.463,.035,.032]],cream);
      if(id==='keeper')tube(model,'Sailor neckline piping',[[-.055,.422,front(-.055,.422)+.004],[-.026,.405,front(-.026,.405)+.004],[0,.392,front(0,.392)+.004],[.026,.405,front(.026,.405)+.004],[.055,.422,front(.055,.422)+.004]],.003,cream);
      for(const y of [.27,.319,.368])for(const x of (id==='keeper'?[-.032,.032]:[0]))oval(model,'Small sewn coat button',[x,y,front(x,y)+.004],[.005,.005,.0025],brass);
      if(id==='visitor'){
        const strap=[];for(let i=0;i<=18;i++){const t=i/18,x=-.063+t*.155,y=.426-t*.18;strap.push([x,y,front(x,y)+.005]);}
        tube(model,'Attached little satchel strap',strap,.006,material('#b28462'));
        oval(model,'Rounded satchel',[.114,.24,.073],[.037,.04,.025],material('#bb906f'));
        oval(model,'Satchel button',[.114,.25,.098],[.004,.004,.002],cream);
      }
    }
    for(const side of [-1,1]){
      const x=side*.063;
      shaped(model,'Short trouser leg',[[.052,.036,.039],[.08,.042,.043],[.14,.047,.049],[.21,.051,.048],[.235,.038,.035]],pants,[x,0,0]);
      shaped(model,'Rounded thin sole',[[0,.030,.050,.021],[.004,.047,.069,.021],[.013,.050,.071,.021],[.018,.048,.068,.021]],sole,[x,0,0],false);
      shaped(model,'Round soft boot',[[.014,.044,.064,.023],[.024,.049,.068,.023],[.043,.047,.064,.023],[.064,.040,.049,.012],[.080,.035,.037,0]],boot,[x,0,0],false);
      shaped(model,'Rolled trouser cuff',[[.072,.043,.044],[.08,.046,.046],[.092,.045,.045],[.098,.041,.041]],pants,[x,0,0]);
    }
    oval(model,'Short attached neck',[0,.46,0],[.033,.034,.031],skin);

    const head=new THREE.Group();head.name='Unified cute head';head.position.set(0,.613,.008);model.add(head);
    const ry=.147,rz=.137;oval(head,'Round cheeked face',[0,0,0],[width,ry,rz],skin);
    const face=(x,y)=>rz*Math.sqrt(Math.max(.01,1-(x/width)**2-(y/ry)**2));
    const eyes=[];
    for(const side of [-1,1]){
      oval(head,'Small attached ear',[side*(width-.004),-.014,-.004],[.020,.026,.020],skin);
      const eye=new THREE.Group();eye.name='Gentle blinking eye';const x=side*.054,y=-.006;eye.position.set(x,y,face(x,y)-.002);head.add(eye);
      oval(eye,'Dark eye',[0,0,0],[.010,.013,.0055],ink);
      oval(eye,'Tiny eye catchlight',[-.0025,.0045,.0048],[.0023,.0028,.001],cream);eyes.push(eye);
      const cheek=[];for(let i=0;i<24;i++){const a=i/24*Math.PI*2;cheek.push([side*.099+Math.cos(a)*.021,-.034+Math.sin(a)*.011]);}
      patch(head,'Soft cheek color',cheek,face,material('#d9ae95'),.0006);
      tube(head,'Quiet curved brow',[[side*.043,.024,face(side*.043,.024)+.001],[side*.054,.027,face(side*.054,.027)+.001],[side*.065,.025,face(side*.065,.025)+.001]],.002,hair);
      oval(head,'Temple hair',[side*(width-.015),id==='visitor'?.046:.065,-.007],[.021,id==='visitor'?.028:.039,.043],hair);
    }
    oval(head,'Tiny button nose',[0,-.029,.135],[.010,.009,.008],skin);
    const smile=[];for(let i=0;i<=12;i++){const x=(i/12-.5)*.036,y=-.062+.005*(Math.abs(x)/.018)**2;smile.push([x,y,face(x,y)+.001]);}
    tube(head,'Small curved smile',smile,.0018,material('#9d7864'));
    oval(head,'Hair cap at back',[0,.078,-.014],[width*.98,.060,.124],hair);
    if(id==='keeper'){
      const navy=material('#3e5a6b');
      shaped(head,'Captain cap band',[[.071,.161,.137],[.079,.168,.142],[.102,.168,.142],[.111,.158,.133]],navy);
      oval(head,'Cream captain crown',[0,.12,-.008],[.175,.051,.146],hat);
      oval(head,'Captain visor',[0,.080,.079],[.163,.010,.097],navy);
      oval(head,'Cap brass badge',[0,.103,.144],[.013,.013,.002],brass);
      tube(head,'Badge anchor stem',[[0,.110,.147],[0,.095,.147]],.0014,cream);
      tube(head,'Badge anchor curve',[[-.007,.100,.147],[-.006,.096,.148],[0,.093,.149],[.006,.096,.148],[.007,.100,.147]],.0014,cream);
    }else if(id==='fisher'){
      oval(head,'Soft knitted hat crown',[0,.126,-.006],[.173,.073,.147],hat);
      shaped(head,'Rolled knit hat rim',[[.066,.160,.134],[.073,.175,.148],[.102,.175,.148],[.116,.166,.139]],hat);
      const rib=material('#bb845b');for(let i=0;i<40;i++){const a=i/40*Math.PI*2; tube(head,'Subtle hat rib',[[Math.sin(a)*.174,.079,Math.cos(a)*.147],[Math.sin(a)*.176,.090,Math.cos(a)*.149],[Math.sin(a)*.171,.106,Math.cos(a)*.143]],.0013,rib);}
      oval(head,'Knit hat top button',[0,.193,-.007],[.022,.013,.021],hat);
    }else{
      shaped(head,'Soft bucket hat crown',[[.072,.161,.137],[.112,.151,.129],[.154,.137,.116],[.176,.090,.078],[.180,.004,.004]],hat);
      shaped(head,'Rounded bucket brim',[[.057,.174,.149],[.063,.191,.164],[.076,.190,.163],[.090,.166,.141]],hat);
      shaped(head,'Bucket hat fabric band',[[.097,.157,.135],[.113,.153,.131]],material('#bbaf89'));
    }

    function arm(side,holding){
      const upper=.105,lower=.085,sy=.418,sx=side*.115;
      const shoulder=new THREE.Bone();shoulder.position.set(sx,sy,0);shoulder.name='Cute shoulder';model.add(shoulder);
      const elbow=new THREE.Bone();elbow.name='Cute elbow';elbow.position.y=-upper;shoulder.add(elbow);
      const wrist=new THREE.Bone();wrist.name='Cute wrist';wrist.position.y=-lower;elbow.add(wrist);
      const profile=smoothProfile([[-upper-lower,.029,.030],[-upper-lower+.018,.032,.033],[-upper-.025,.038,.039],[-upper,.043,.044],[-.055,.049,.049],[-.01,.051,.051],[.017,.043,.043],[.035,.024,.025],[.041,.003,.003]]);
      const g=geometry(profile,32),positions=g.attributes.position,indices=[],weights=[];g.translate(sx,sy,0);
      for(let i=0;i<positions.count;i++){const w=THREE.MathUtils.smoothstep(sy-positions.getY(i),upper-.035,upper+.035);indices.push(0,1,0,0);weights.push(1-w,w,0,0);}
      g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
      const sleeve=new THREE.SkinnedMesh(g,coat);sleeve.name='Continuous soft sleeve';sleeve.frustumCulled=false;model.add(sleeve);model.updateMatrixWorld(true);sleeve.bind(new THREE.Skeleton([shoulder,elbow,wrist]));
      const palm=oval(wrist,'Soft mitten hand',[0,-.024,.006],[.025,.031,.022],skin);
      oval(wrist,'Attached little thumb',[side*.021,-.017,.016],[.011,.019,.011],skin);
      shaped(wrist,'Soft rolled sleeve cuff',[[-.007,.032,.032],[0,.035,.035],[.011,.033,.033]],id==='fisher'?cream:coat);
      return {shoulder,elbow,wrist,palm,sleeve};
    }
    const free=arm(-1,false),held=arm(1,true);held.shoulder.rotation.z=.32;held.elbow.rotation.z=.10;
    const hand=held.wrist;
    if(id==='visitor'){
      shaped(hand,'Little ceramic mug',[[-.058,.019,.019],[-.052,.025,.025],[-.009,.027,.027]],cream,[.036,0,.014]);
      const coffee=new THREE.Mesh(new THREE.CircleGeometry(.023,32),material('#72563d'));coffee.rotation.x=-Math.PI/2;coffee.position.set(.036,-.008,.014);hand.add(coffee);
      const handle=new THREE.Mesh(new THREE.TorusGeometry(.012,.0035,10,24),cream);handle.position.set(.011,-.031,.014);hand.add(handle);
    }else if(id==='keeper'){
      const handle=new THREE.Mesh(new THREE.TorusGeometry(.020,.003,10,24),brass);handle.position.set(0,-.053,.004);hand.add(handle);
      const glass=material('#e7c686',.5);glass.emissive=new THREE.Color('#b78a42');glass.emissiveIntensity=.20;
      oval(hand,'Small lantern globe',[0,-.102,.004],[.028,.032,.028],glass);
      for(const y of [-.073,-.135])shaped(hand,'Lantern fitted rim',[[y-.005,.034,.034],[y+.005,.034,.034]],brass,[0,0,.004]);
      for(let j=0;j<4;j++){const a=j*Math.PI/2,x=Math.sin(a)*.028,z=.004+Math.cos(a)*.028;tube(hand,'Lantern frame',[[x,-.075,z],[x,-.135,z]],.0025,brass);}
    }else{
      tube(hand,'Fine fishing rod',[[0,-.023,.012],[.11,.12,.012],[.25,.32,.012]],.0035,material('#9b7e58'));
      tube(hand,'Fishing rod grip',[[0,-.03,.012],[.027,.004,.012]],.0065,boot);
      oval(hand,'Little fishing reel',[-.010,-.012,.025],[.011,.011,.008],brass);
      tube(hand,'Attached fishing line',[[.25,.32,.012],[.264,.20,.012],[.264,.06,.012]],.0008,cream);
      oval(hand,'Fishing float',[.264,.051,.012],[.007,.013,.007],hat);
    }
    // Find a nearby pose where toe/heel samples of both feet rest on the same
    // paving level. This also avoids bringing the removed thick shoe blocks back.
    person.updateWorldMatrix(true,true);const down=new THREE.Raycaster();
    const offsets=[-.16,-.08,0,.08,.16].flatMap(x=>[-.16,-.08,0,.08,.16].map(z=>[x,z])).sort((a,b)=>a[0]**2+a[1]**2-b[0]**2-b[1]**2);
    let contacts=[],placement=[0,0],best=Infinity;
    for(const [dx,dz] of offsets){const samples=[];
      for(const side of [-1,1])for(const z of [-.018,.024,.067]){const foot=person.localToWorld(v(side*.063,0,z)).add(v(dx,0,dz));down.set(foot.clone().add(v(0,.16,0)),v(0,-1,0));const hit=down.intersectObjects(ground,false)[0];if(hit&&hit.distance<.4)samples.push({foot:foot.toArray(),surface:hit.point.y,name:label(hit.object)});}
      if(samples.length!==6)continue;const gap=Math.max(...samples.map(c=>c.surface))-Math.min(...samples.map(c=>c.surface));if(gap<best){best=gap;contacts=samples;placement=[dx,dz];}if(gap<.014)break;
    }
    const adjust=contacts.length?Math.max(...contacts.map(c=>c.surface-c.foot[1])):0,world=person.getWorldPosition(v()).add(v(placement[0],adjust,placement[1]));person.position.copy(person.parent.worldToLocal(world));
    const footing=contacts.map(c=>({surface:c.name,clearance:c.foot[1]+adjust-c.surface}));
    actors.push({id,person,model,head,eyes,...free,held,footing,torsoProfile});
  }
  function update(time,until,reduced){
    const remain=until-time,age=5.5-remain,lift=remain>0?Math.min(THREE.MathUtils.smoothstep(age,0,1.25),THREE.MathUtils.smoothstep(remain,0,1.25)):0;
    actors.forEach((a,i)=>{
      a.shoulder.rotation.z=THREE.MathUtils.lerp(-.40,-1.35,lift);a.elbow.rotation.z=THREE.MathUtils.lerp(-.06,-1.50,lift);a.wrist.rotation.z=(reduced?.04:.12)*Math.sin(age*4.7)*lift;
      a.head.rotation.y=.08*lift;a.head.rotation.z=.045*lift;a.head.rotation.x=-.025*lift;
      const phase=(time+i*1.73)%7.4,blink=reduced?1:phase<.18?Math.max(.12,Math.abs(phase-.09)/.09):1;
      a.eyes.forEach(e=>e.scale.y=blink);
    });
  }
  update(1,-1,false);
  return {update,actors,inspect:()=>actors.map(a=>{
    a.person.updateWorldMatrix(true,true);const hand=a.wrist.getWorldPosition(v()),head=a.head.getWorldPosition(v());
    // Check the skinned sleeve against the full head surface at the current pose.
    const p=v(),local=v(),headScale=a.id==='fisher'?.168:a.id==='visitor'?.161:.158;let headClearance=Infinity;
    for(let i=0;i<a.sleeve.geometry.attributes.position.count;i+=8){a.sleeve.getVertexPosition(i,p);local.copy(p);a.sleeve.localToWorld(local);a.head.worldToLocal(local);headClearance=Math.min(headClearance,(local.x/headScale)**2+(local.y/.147)**2+(local.z/.137)**2);}
    return {id:a.id,head:head.toArray(),hand:hand.toArray(),handHeadDistance:hand.distanceTo(head),shoulder:a.shoulder.rotation.z,elbow:a.elbow.rotation.z,sleeveType:a.sleeve.type,heldSleeveType:a.held.sleeve.type,faceAttached:true,oldVisible:a.person.children.filter(o=>o!==a.model&&o.visible).length,holdingArmMoved:false,footing:a.footing,headSleeveClearance:headClearance,style:'soft miniature 2.4 heads'};
  })};
}
