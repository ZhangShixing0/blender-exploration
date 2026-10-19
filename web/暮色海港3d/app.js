import * as THREE from 'three';
import { OrbitControls } from './vendor/three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from './vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from './vendor/three/examples/jsm/loaders/DRACOLoader.js';
import { repairHarborMaterials } from './harbor-materials.js?v=night332';
import {preloadHarborCast} from './harbor-cast.js?v=harbor340';
import {batchHarborStatics} from './harbor-static-batches.js?v=harbor340';
import {repairKeeperBench} from './harbor-bench.js?v=harbor341';
import { createHarborInteractions, RIPPLE_GLSL } from './harbor-interactions.js?v=harbor342';

const loadMetrics=window.__harborLoadMetrics=[];
const markLoad=stage=>loadMetrics.push({stage,ms:Math.round(performance.now())});
markLoad('module');
let renderedReady=false,readyToRender=false,batchReport=null;
const MODEL_URL = './assets/moonlit-harbor-v340-textures.glb';
const WATER_LEVEL = .52;
const SEABED_LEVEL = -.90;
const canvas = document.querySelector('#scene-canvas');
const statusText = document.querySelector('#status-text');
const statusDot = document.querySelector('.status-dot');
const loadReadout = document.querySelector('#load-readout');
const loadBarFill = document.querySelector('#load-bar-fill');
const assetState = document.querySelector('#asset-state');
const errorState = document.querySelector('#error-state');
const controls = [...document.querySelectorAll('[data-control]')];
const lightingButtons = [...document.querySelectorAll('[data-lighting]')];
const lightingReadout = document.querySelector('#lighting-readout');
lightingButtons.forEach((button) => { button.disabled = true; });

let renderer;
let scene;
let camera;
let orbit;
let harbor;
let hemisphereLight;
let keyLight;
let fillLight;
let materialRepairReport;
const practicalLights = [];
let waterOverlay;
let waterMaterial;
let waterBottom;
let waterCaustics;
let waterWalls = [];
let importedUnderwaterDetails = [];
let sandPatches = [];
let underwaterGroup;
let underwaterActors = [];
let waterContacts;
const contactUniforms = { uWaterTime: { value: 0 }, uWaterVisible: { value: 1 } };
let lighthouseLeft;
let lighthouseRight;
let lighthouseTargets;
let sweepEnabled = true;
let waterEnabled = true;
let nightEnabled = !new URLSearchParams(window.location.search).has('day');
let lightingMode = 'neutral';
let lightingBaseExposure = 1.05;
const clock = new THREE.Clock();
let cameraMove = null;
let interactions = null;
let qaElapsed = null;
let previousElapsed = 0;
const qualityCaps = { low: .85, balanced: 1.25, high: 1.75 };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function setStatus(label, state = 'loading') {
  statusText.textContent = label;
  statusDot.classList.toggle('ready', state === 'ready');
  statusDot.classList.toggle('error', state === 'error');
  document.querySelector('#load-state').hidden = state !== 'loading';
}

function createRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityCaps[document.querySelector('#quality').value]));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = lightingBaseExposure;
}

function createScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#07162c');
  scene.fog = new THREE.Fog('#07162c', 38, 90);
  const mobileViewport = window.innerWidth < 700;
  camera = new THREE.PerspectiveCamera(mobileViewport ? 58 : 42, window.innerWidth / window.innerHeight, .1, 160);
  // Y is up after the glTF export; start above the island so the basin reads
  // as a broad foreground plane like the reference screenshots.
  camera.position.set(...(mobileViewport ? [16.8, 25.88, 33.6] : [12.6, 19.28, 28.2]));
  frameScene();
  orbit = new OrbitControls(camera, canvas);
  orbit.target.set(0, 2.6, 0);
  orbit.enableDamping = true;
  orbit.dampingFactor = .06;
  orbit.minDistance = 9;
  orbit.maxDistance = 55;
  orbit.maxPolarAngle = Math.PI * .48;
  orbit.minPolarAngle = Math.PI * .18;
  orbit.update();
  orbit.addEventListener('start', () => {
    cameraMove = null;
    document.querySelectorAll('[data-view]').forEach(button => {
      button.classList.remove('selected'); button.setAttribute('aria-pressed', 'false');
    });
  });

  hemisphereLight = new THREE.HemisphereLight('#ffffff', '#17202a', 1.15);
  scene.add(hemisphereLight);
  keyLight = new THREE.DirectionalLight('#fff8e9', .55);
  keyLight.position.set(-12, 22, 30);
  scene.add(keyLight);
  fillLight = new THREE.DirectionalLight('#dbe8f5', .18);
  fillLight.position.set(15, 12, 14);
  scene.add(fillLight);
}

// Fine, irregular caustics are projected onto the bed; the surface keeps its
// own shallow ripples so the waterline and seabed remain separate planes.
const causticGLSL = `
vec2 cellHash(vec2 p) { return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453); }
float causticNet(vec2 p,float t) {
  p+=vec2(sin(p.y*.72+t*.22),cos(p.x*.61-t*.19))*.18;
  vec2 cell=floor(p), f=fract(p); float a=8.0,b=8.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
    vec2 g=vec2(float(x),float(y)); vec2 h=cellHash(cell+g);
    vec2 r=g+.5+.32*sin(6.2831*h+t*.15)-f;
    float d=dot(r,r); if(d<a){b=a;a=d;}else{b=min(b,d);}
  }
  return 1.0-smoothstep(.012,.075,b-a);
}`;

function createWaterBasin() {
  const geometry = new THREE.PlaneGeometry(17.55, 13.55, 128, 96);
  waterMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: .27 }, uNight: { value: 0 } },
    vertexShader: `uniform float uTime; varying vec2 vUv; varying vec3 vWorld; ${RIPPLE_GLSL} void main(){ vUv=uv; vec3 p=position; p.z += sin(p.x*2.6+uTime*.82)*.024 + cos(p.y*2.1-uTime*.66)*.018 + touchWave(vec2(p.x,-p.y),uTime); vWorld=(modelMatrix*vec4(p,1.0)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0); }`,
    fragmentShader: `uniform float uTime; uniform float uOpacity; uniform float uNight; varying vec2 vUv; varying vec3 vWorld;
      ${causticGLSL}
      ${RIPPLE_GLSL}
      void main(){
        float t=uTime;
        float dx=(touchWave(vWorld.xz+vec2(.025,0.),t)-touchWave(vWorld.xz-vec2(.025,0.),t))/.05;
        float dz=(touchWave(vWorld.xz+vec2(0.,.025),t)-touchWave(vWorld.xz-vec2(0.,.025),t))/.05;
        vec3 n=normalize(vec3(-.0624*cos(vWorld.x*2.6+t*.82)-dx,1.0,-.0378*sin(vWorld.z*2.1+t*.66)-dz));
        vec3 viewDir=normalize(cameraPosition-vWorld);
        float fresnel=pow(1.0-max(dot(n,viewDir),0.0),3.0);
        float gleam=pow(max(dot(reflect(-normalize(vec3(-.6,1.0,.8)),n),viewDir),0.0),80.0);
        float lace=causticNet(vWorld.xz*2.15,t);
        vec3 c=mix(vec3(.12,.62,.66),vec3(.72,.88,.91),fresnel*.65);
        c+=vec3(.38,.46,.39)*(lace*.30+gleam*.45);
        c+=vec3(.50,.65,.67)*clamp(-dx*.65+dz*.4,-.5,.5);
        c*=mix(1.0,.58,uNight);
        float a=clamp(uOpacity+fresnel*.25+lace*.08+gleam*.13+min(.16,(abs(dx)+abs(dz))*.14),0.0,.65);
        gl_FragColor=vec4(c,uOpacity>0.0?a:0.0);
      }`
  });
  waterOverlay = new THREE.Mesh(geometry, waterMaterial);
  // GLB is exported Y-up. PlaneGeometry is XY by default, so rotate it
  // onto the XZ water surface instead of leaving it vertical on the Z axis.
  waterOverlay.rotation.x = -Math.PI / 2;
  // Imported GLB bounds place the water surface at Y=0.38..0.50.
  waterOverlay.position.set(0, WATER_LEVEL, 0);
  waterOverlay.renderOrder = 3;
  waterOverlay.name = 'Runtime deep water surface';
  scene.add(waterOverlay);

  const causticsMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; ${causticGLSL} void main(){ vec2 p=vUv*vec2(37.0,28.5); float line=causticNet(p,uTime); gl_FragColor=vec4(.84,.97,.88,line*.25); }`
  });
  waterCaustics = new THREE.Mesh(new THREE.PlaneGeometry(17.4, 13.3), causticsMaterial);
  waterCaustics.rotation.x = -Math.PI / 2;
  waterCaustics.position.set(0, SEABED_LEVEL + .014, 0);
  waterCaustics.renderOrder = 1;
  scene.add(waterCaustics);

  // The seabed is now real geometry inside the Blender model. Adding another
  // colored browser plane over it would flatten the water again.
  // Keep the water open at the perimeter. A previous pair of vertical walls
  // made the basin read as a sealed aquarium box instead of an open shoreline.
  // Keep the imported front/right cut faces; they show water thickness
  // without enclosing all four sides of the shoreline.
  createUnderwaterDetails();
  createContactRipples();
}

function createContactRipples() {
  waterContacts = new THREE.Group();
  waterContacts.name = 'Waterline ripples touching hulls and piles';
  scene.add(waterContacts);
  harbor.updateMatrixWorld(true);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: contactUniforms.uWaterTime },
    vertexShader: `uniform float uTime; varying vec2 vUv; void main(){vUv=uv;vec3 p=position;p.y+=sin(p.x*2.6+uTime*.82)*.024+cos(p.z*2.1+uTime*.66)*.018;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
    fragmentShader: `uniform float uTime;varying vec2 vUv;void main(){float ring=pow(.5+.5*cos(vUv.y*18.85-uTime*.6),5.0);float broken=.3+.7*smoothstep(-.4,.6,sin(vUv.x*53.0+uTime*.2));float alpha=ring*broken*(1.0-vUv.y)*.32;gl_FragColor=vec4(.78,.95,.90,alpha);}`
  });
  const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  harbor.traverse((obj) => {
    const name = (obj.userData?.name || obj.name).replace(/_/g,' ').toLowerCase();
    if (!obj.isMesh || !/painted hull|pier piling|gangway support/.test(name) || /rope|end grain/.test(name)) return;
    const geo=obj.geometry, pos=geo.attributes.position, idx=geo.index;
    const points=[]; const vertices=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
    for(let i=0;i<(idx?idx.count:pos.count);i+=3) {
      vertices.forEach((v,j) => v.fromBufferAttribute(pos,idx?idx.getX(i+j):i+j).applyMatrix4(obj.matrixWorld));
      for(let j=0;j<3;j++) {
        const a=vertices[j],b=vertices[(j+1)%3];
        if ((a.y-WATER_LEVEL)*(b.y-WATER_LEVEL)>=0) continue;
        const f=(WATER_LEVEL-a.y)/(b.y-a.y);
        points.push(new THREE.Vector2(THREE.MathUtils.lerp(a.x,b.x,f),THREE.MathUtils.lerp(a.z,b.z,f)));
      }
    }
    points.sort((a,b)=>a.x-b.x||a.y-b.y);
    const unique=points.filter((p,i)=>!i||p.distanceTo(points[i-1])>.0001);
    if(unique.length<3)return;
    const lower=[],upper=[];
    for(const p of unique){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
    for(const p of [...unique].reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
    const outline=lower.slice(0,-1).concat(upper.slice(0,-1));
    const center=outline.reduce((s,p)=>s.add(p),new THREE.Vector2()).multiplyScalar(1/outline.length);
    const positions=[],uvs=[],indices=[];
    outline.concat([outline[0]]).forEach((p,i)=>{
      const out=p.clone().sub(center).normalize();
      for(const width of [.005,.12]){positions.push(p.x+out.x*width,WATER_LEVEL+.006,p.y+out.y*width);uvs.push(i/outline.length,width===.005?0:1);}
      if(i<outline.length){const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}
    });
    const ring=new THREE.BufferGeometry();
    ring.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    ring.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));ring.setIndex(indices);
    const mesh=new THREE.Mesh(ring,mat);mesh.renderOrder=4;waterContacts.add(mesh);
  });
}

function createUnderwaterDetails() {
  underwaterGroup = new THREE.Group();
  underwaterGroup.name = 'Runtime swimming fish';
  scene.add(underwaterGroup);
  // Grass, rocks and sand now have one source of truth in the Blender model.
  // The former duplicate browser props stayed at the old height and floated.

  const fishBody = new THREE.IcosahedronGeometry(.16, 1);
  const fishTail = new THREE.ConeGeometry(.095, .22, 3);
  const fishMats = [
    new THREE.MeshBasicMaterial({ color: '#e5b85a', transparent: true, opacity: .82 }),
    new THREE.MeshBasicMaterial({ color: '#75b8ad', transparent: true, opacity: .80 }),
    new THREE.MeshBasicMaterial({ color: '#cf8a52', transparent: true, opacity: .80 })
  ];
  const fishSpecs = [
    { x: -5.5, z: 4.55, y: -.30, dir: 1, speed: .055, span: .50, phase: .2 },
    { x: -2.0, z: 4.15, y: -.18, dir: -1, speed: .045, span: .42, phase: 1.7 },
    { x: .95, z: 5.05, y: -.38, dir: 1, speed: .050, span: .55, phase: 2.8 },
    { x: 3.9, z: 4.35, y: -.24, dir: -1, speed: .040, span: .45, phase: 4.0 },
    { x: 6.15, z: 3.55, y: -.30, dir: 1, speed: .047, span: .38, phase: 5.2 }
  ];
  fishSpecs.forEach((spec, i) => {
    const actor = new THREE.Group();
    actor.position.set(spec.x, spec.y, spec.z);
    actor.scale.x = spec.dir;
    const body = new THREE.Mesh(fishBody, fishMats[i % fishMats.length]);
    body.scale.set(1.18, .55, .62);
    body.renderOrder = 2;
    actor.add(body);
    const tail = new THREE.Mesh(fishTail, fishMats[i % fishMats.length]);
    tail.rotation.z = Math.PI / 2;
    tail.position.x = -.22;
    tail.renderOrder = 2;
    actor.add(tail);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.018, 6, 4), new THREE.MeshBasicMaterial({ color: '#f8e9bd', transparent: true, opacity: .9 }));
    eye.position.set(.12, .045, -.105);
    eye.renderOrder = 3;
    actor.add(eye);
    actor.userData = { ...spec, originX: spec.x };
    actor.renderOrder = 2;
    underwaterGroup.add(actor);
    underwaterActors.push(actor);
  });
}

function createLighthouseSweep() {
  lighthouseTargets = [new THREE.Object3D(), new THREE.Object3D()];
  lighthouseTargets[0].position.set(-13, 4.6, -3.5);
  lighthouseTargets[1].position.set(15, 4.6, -4.5);
  lighthouseTargets.forEach((target) => scene.add(target));
  lighthouseLeft = new THREE.SpotLight('#ffd47d', 8, 32, Math.PI / 11, .78, 1.3);
  lighthouseRight = new THREE.SpotLight('#ffd47d', 8, 32, Math.PI / 11, .78, 1.3);
  const source = new THREE.Vector3(1.75, 7.42, -3.9);
  lighthouseLeft.position.copy(source);
  lighthouseRight.position.copy(source);
  lighthouseLeft.target = lighthouseTargets[0];
  lighthouseRight.target = lighthouseTargets[1];
  scene.add(lighthouseLeft, lighthouseRight);

  // The Blender beam meshes are designed for Cycles volume rendering. In a
  // browser they become opaque wedges, so replace them with lightweight
  // translucent cones that can follow the realtime sweep targets.
  if (harbor) harbor.traverse((object) => {
    const materialNames = Array.isArray(object.material)
      ? object.material.map((material) => material?.name || '').join(' ')
      : object.material?.name || '';
    const name = `${object.name || ''} ${materialNames}`.toLowerCase();
    if (name.includes('beam') || name.includes('haze') || name.includes('volume')) object.visible = false;
  });
  const beamGeometry = new THREE.ConeGeometry(1.05, 24, 48, 1, true);
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: '#ffe6af', transparent: true, opacity: .23,
    depthWrite: false, depthTest: true, blending: THREE.NormalBlending, side: THREE.DoubleSide
  });
  const makeBeam = () => {
    const mesh = new THREE.Mesh(beamGeometry, beamMaterial.clone());
    mesh.material.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec2 vBeamUv; varying vec3 vBeamNormal; varying vec3 vBeamWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBeamUv=uv;vBeamNormal=mat3(modelMatrix)*normal;vBeamWorld=(modelMatrix*vec4(position,1.0)).xyz;');
      shader.fragmentShader = 'varying vec2 vBeamUv; varying vec3 vBeamNormal; varying vec3 vBeamWorld;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'diffuseColor.a*=pow(abs(dot(normalize(vBeamNormal),normalize(cameraPosition-vBeamWorld))),.7)*smoothstep(0.,.3,vBeamUv.y);\n#include <opaque_fragment>');
    };
    mesh.position.copy(source);
    mesh.renderOrder = 2;
    scene.add(mesh);
    return mesh;
  };
  lighthouseLeft.beamMesh = makeBeam();
  lighthouseRight.beamMesh = makeBeam();
}

function addImmersionTint(object) {
  const originals = Array.isArray(object.material) ? object.material : [object.material];
  const materials = originals.map((original) => {
    const mat = original.clone();
    mat.onBeforeCompile = (shader) => {
      original.onBeforeCompile(shader);
      Object.assign(shader.uniforms, contactUniforms);
      shader.vertexShader = 'varying vec3 vContactWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', 'vContactWorld=(modelMatrix*vec4(transformed,1.0)).xyz;\n#include <project_vertex>');
      shader.fragmentShader = 'varying vec3 vContactWorld; uniform float uWaterTime; uniform float uWaterVisible;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        float waterY=.52+sin(vContactWorld.x*2.6+uWaterTime*.82)*.024+cos(vContactWorld.z*2.1+uWaterTime*.66)*.018;
        float immersion=waterY-vContactWorld.y;
        float wet=smoothstep(-.018,.012,immersion)*uWaterVisible;
        float depth=clamp(immersion/1.42,0.0,1.0);
        vec3 submerged=mix(outgoingLight*vec3(.66,.90,.90),vec3(.10,.38,.37),.38+depth*.32);
        outgoingLight=mix(outgoingLight,submerged,wet);
        #include <opaque_fragment>
      `);
    };
    mat.customProgramCacheKey = () => `${original.customProgramCacheKey()}-harbor-immersion-331`;
    return mat;
  });
  object.material = Array.isArray(object.material) ? materials : materials[0];
}

function tuneMaterials(root) {
  root.traverse((object) => {
    const objectMaterials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
    // GLTFLoader sanitizes Blender node names (spaces become underscores).
    // Prefer the exported original name and normalize both forms before
    // filtering, otherwise the opaque legacy water/plinth stays in the scene.
    const originalName = object.userData?.name || object.name || '';
    const name = `${originalName} ${objectMaterials.map((material) => material?.name || '').join(' ')}`.replace(/_/g, ' ').toLowerCase();
    // Name filtering happens before the mesh guard so exported curves and
    // line objects carrying the old water passes are hidden as well.
    if (name.includes('studio ground') || name.includes('dark seabed within plinth') || name.includes('rounded walnut display plinth') || name.includes('narrow bronze plinth reveal') || name.includes('gently undulating water surface') || name.includes('v3.30 clear tidal water surface')) {
      object.visible = false;
      return;
    }
    // Hide the legacy v3.25 layer. The current Blender seabed owns grass and
    // stones; only swimming fish are recreated at runtime.
    if (name.includes('v3.25 submerged seabed') || name.includes('v3.25 submerged stone') || name.includes('v3.25 fish') || name.includes('v3.25 underwater grass')) {
      object.visible = false;
      return;
    }
    if (name.includes('v3.30 pale sandy seabed')) {
      waterBottom = object;
      object.material = new THREE.MeshBasicMaterial({ color: '#87c8bd' });
    }
    if (object.isMesh && (name.includes('v3.30 seagrass') || name.includes('v3.30 pale sand patch') || name.includes('v3.30 submerged stone'))) importedUnderwaterDetails.push(object);
    if (object.isMesh && name.includes('v3.30 pale sand patch')) {
      object.material = new THREE.MeshBasicMaterial({ color: '#a0cfc1' });
      sandPatches.push(object);
    }
    if (object.isMesh && name.includes('v3.30 exposed') && name.includes('water cut')) {
      object.material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uNight: { value: 0 } },
        vertexShader: `varying float vDepth; void main(){ vec4 p=modelMatrix*vec4(position,1.0); vDepth=clamp((.52-p.y)/1.42,0.0,1.0); gl_Position=projectionMatrix*viewMatrix*p; }`,
        fragmentShader: `uniform float uNight; varying float vDepth; void main(){ vec3 c=mix(vec3(.57,.84,.82),vec3(.22,.59,.65),vDepth); c*=mix(1.0,.65,uNight); gl_FragColor=vec4(c,.16+.22*vDepth); }`
      });
      waterWalls.push(object);
    }
    // The GLB contains several older water-streak and golden-reflection
    // passes. They make the open water look dirty when combined with the
    // clearer runtime surface, so keep only the shoreline foam meshes.
    if (name.includes('v3 open water streak') || name.includes('v3 warm reflection') || name.includes('golden reflection') || name.includes('directional wave') || name.includes('v3 foam crest') || name.includes('v3.5 foam island') || name.includes('irregular floating foam lace') || name.includes('shore foam') || name.includes('broken foam around coastal stones') || name.includes('fine broken sea froth') || name.includes('v3 teal water with directional flow') || name.includes('v3 bright sea foam') || name.includes('v3.5 natural foam') || name.includes('v3.6 natural foam') || name.includes('v3.8 teal wave crests') || name.includes('v3.8 sea foam accents') || name.includes('v3 warm water glints') || name.includes('v3.8 broken golden reflections') || name.includes('shallow teal seabed') || name.includes('v3.25 deep teal seabed')) {
      object.visible = false;
      return;
    }
    if (!object.isMesh || !object.material) return;
    const materials = objectMaterials;
    materials.forEach((material) => {
      if (!material.userData.harborOriginalLighting) {
        material.userData.harborOriginalLighting = {
          emissive: material.emissive?.clone() || null,
          emissiveIntensity: material.emissiveIntensity ?? 0
        };
      }
      if (name.includes('beam') || name.includes('haze') || name.includes('volume')) {
        material.transparent = true;
        material.opacity = 0;
        object.visible = false;
      }
      if (name.includes('water') || name.includes('foam') || name.includes('wave')) {
        material.userData.isHarborWater = true;
        if ('roughness' in material) material.roughness = Math.min(material.roughness, .32);
        if (name.includes('gently undulating water') && material.color) {
          material.color.set('#0d5963');
          // The old GLB water is a single shallow sheet. Hide it so the
          // runtime basin below can provide real depth, seabed and fish.
          object.visible = false;
          object.userData.harborOriginalWaterHidden = true;
        }
      }
      if (name.includes('glow') || name.includes('amber') || name.includes('lantern') || name.includes('pane')) {
        material.emissive = material.emissive || new THREE.Color('#000000');
        material.emissive.set('#ffb64d');
        material.emissiveIntensity = Math.max(material.emissiveIntensity || 0, 1.8);
      }
    });
    if (/painted hull|piling|gangway support|coastal cliff boulder|breakwater protection rock|beach edging stone|irregular intertidal stone|layered cliff rock|lower harbor land|submerged foundation|diagonal brace/.test(name)) {
      addImmersionTint(object);
    }
  });
}

const lightingProfiles = {
  neutral: {
    label: '月夜 · 清晰本色',
    hemisphere: ['#b4c9de', '#667b8d', 1.2],
    key: ['#ccdfff', 1.15],
    fill: ['#8fb8d2', .4],
    sweep: 6,
    exposure: 1.02,
    practical: 1,
    background: '#12263d'
  },
  cinematic: {
    label: '氛围 · 冷暖分层',
    hemisphere: ['#a5bfdc', '#526b7c', 1.05],
    key: ['#bfd9ff', 1.4],
    fill: ['#83aabd', .3],
    sweep: 8,
    exposure: 1.06,
    practical: 1.3,
    background: '#10223a'
  },
  flat: {
    label: '少光 · 只留基础照明',
    hemisphere: ['#c3d2db', '#647788', 1.3],
    key: ['#d3e0ed', .5],
    fill: ['#b9cddc', .25],
    sweep: 0,
    exposure: 1.0,
    practical: .65,
    background: '#13263a'
  }
};

function restoreOriginalGlow(mode) {
  if (!harbor) return;
  harbor.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      const original = material.userData.harborOriginalLighting;
      if (!original) return;
      // Only actual light emitters glow. Window frames and lantern housings
      // must keep their ordinary paint/metal instead of turning orange.
      const name=material.name.toLowerCase();
      if (/honey window glass|luminous lantern core|lighthouse bright core|lighthouse warm halo/.test(name)) {
        material.emissive = material.emissive || new THREE.Color('#000000');
        material.emissive.set('#ffdaa0');
        material.emissiveIntensity = nightEnabled ? (mode==='cinematic'?1.7:1.3) : .3;
      } else if (original.emissive) {
        material.emissive.copy(original.emissive);
        material.emissiveIntensity = original.emissiveIntensity;
      }
    });
  });
}

function createPracticalLights() {
  harbor.updateMatrixWorld(true);
  const centers=[];
  harbor.traverse((object)=>{
    const name=(object.userData?.name || object.name).replace(/_/g,' ').toLowerCase();
    if(!object.isMesh || !/window glowing pane/.test(name))return;
    const box=new THREE.Box3().setFromObject(object),position=box.getCenter(new THREE.Vector3());
    if(centers.some(p=>p.distanceTo(position)<.7))return;
    centers.push(position.clone());
    const size=box.getSize(new THREE.Vector3());
    if(size.x<size.z)position.x+=.45;else position.z+=.45;
    const light=new THREE.PointLight('#ffcf8a',1.7,3.2,2);
    light.position.copy(position);light.userData.baseIntensity=1.7;
    practicalLights.push(light);scene.add(light);
  });
  // Pools of warm light under the harbor lamps and around the lantern room.
  for(const [x,y,z,power,range] of [[1.75,7.4,-3.9,3,3],[2.1,2.0,3.9,3,3],[-5.1,1.8,3.1,2.5,2.8],[5.9,2.0,1.3,2.5,3]]) {
    const light=new THREE.PointLight('#ffce86',power,range,2);
    light.position.set(x,y,z);light.userData.baseIntensity=power;
    practicalLights.push(light);scene.add(light);
  }
}

function applyLightingMode(mode) {
  const profile = lightingProfiles[mode] || lightingProfiles.neutral;
  lightingMode = mode;
  lightingBaseExposure = profile.exposure;
  if (hemisphereLight) {
    hemisphereLight.color.set(profile.hemisphere[0]);
    hemisphereLight.groundColor.set(profile.hemisphere[1]);
    hemisphereLight.intensity = profile.hemisphere[2];
  }
  if (keyLight) {
    keyLight.color.set(profile.key[0]);
    keyLight.intensity = profile.key[1];
  }
  if (fillLight) {
    fillLight.color.set(profile.fill[0]);
    fillLight.intensity = profile.fill[1];
  }
  if (!nightEnabled) {
    hemisphereLight.color.set('#dfe9e8');hemisphereLight.groundColor.set('#aaa797');hemisphereLight.intensity=mode==='flat'?2.0:1.7;
    keyLight.color.set(mode==='cinematic'?'#ffe4b9':'#fff0d6');keyLight.intensity=mode==='flat'?.45:mode==='cinematic'?2.5:2.1;
    fillLight.color.set('#c5dce3');fillLight.intensity=mode==='flat'?.25:.55;
  }
  practicalLights.forEach(light=>{light.intensity=light.userData.baseIntensity*(nightEnabled?profile.practical:.06);});
  if (lighthouseLeft && lighthouseRight) {
    lighthouseLeft.intensity = sweepEnabled ? profile.sweep : 0;
    lighthouseRight.intensity = sweepEnabled ? profile.sweep : 0;
    [lighthouseLeft, lighthouseRight].forEach((light) => {
      if (light.beamMesh) {light.beamMesh.visible = sweepEnabled && profile.sweep > 0;light.beamMesh.material.opacity=nightEnabled?.23:.08;}
    });
  }
  renderer.toneMappingExposure = nightEnabled ? lightingBaseExposure : 1.05;
  document.body.classList.toggle('daylight', !nightEnabled);
  scene.background.set(nightEnabled ? profile.background : '#e1e0db');
  scene.fog.color.set(nightEnabled ? profile.background : '#e1e0db');
  if (waterBottom?.material?.color) waterBottom.material.color.set(nightEnabled ? '#2e6874' : '#87c8bd');
  if (waterMaterial) {
    waterMaterial.uniforms.uOpacity.value = waterEnabled ? (nightEnabled ? .23 : .27) : 0;
    waterMaterial.uniforms.uNight.value = nightEnabled ? 1 : 0;
  }
  waterWalls.forEach((wall) => { wall.material.uniforms.uNight.value = nightEnabled ? 1 : 0; });
  sandPatches.forEach((patch) => { patch.material.color.set(nightEnabled ? '#3c737d' : '#a0cfc1'); });
  restoreOriginalGlow(mode);
  lightingButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.lighting === mode);
    button.setAttribute('aria-pressed', String(button.dataset.lighting === mode));
  });
  if (lightingReadout) lightingReadout.textContent = nightEnabled ? profile.label : ({neutral:'日景 · 清晰本色',cinematic:'日景 · 暖阳层次',flat:'日景 · 柔和少光'}[mode]);
  document.querySelector('#scene-poem').textContent = nightEnabled ? '灯亮了，听一会儿海。' : '海风很轻，日子很慢。';
  document.querySelector('#scene-time').textContent = nightEnabled ? '夜色 · 海风轻拂' : '日光 · 慢慢漫游';
  document.querySelector('meta[name="theme-color"]').content = nightEnabled ? profile.background : '#e1e0db';
  const sweepButton = document.querySelector('[data-control="sweep"]');
  sweepButton.disabled = profile.sweep === 0;
  sweepButton.title = profile.sweep === 0 ? '选择「氛围」光线可开启灯塔光束' : '开关灯塔光束';
}

function loadHarbor() {
  markLoad('load-start');
  preloadHarborCast();
  const draco = new DRACOLoader();
  draco.setDecoderPath('./vendor/three/examples/jsm/libs/draco/gltf/');
  draco.preload();
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const launchPromise=loader.loadAsync('./assets/pilot-launch-v336.glb');
  loader.load(MODEL_URL, async (gltf) => {
    let visitingBoat;try{visitingBoat=(await launchPromise).scene;}catch(error){console.error(error);setStatus('引航船加载失败','error');errorState.hidden=false;errorState.style.display='flex';return;}
    markLoad('island-decoded');
    harbor = gltf.scene;
    materialRepairReport = repairHarborMaterials(harbor);
    tuneMaterials(harbor);
    scene.add(harbor);
    const benchRepair=repairKeeperBench(harbor);
    markLoad('island-materials');
    createWaterBasin();
    markLoad('water-built');
    createLighthouseSweep();
    createPracticalLights();
    applyLightingMode('neutral');
    markLoad('lights-ready');
    assetState.textContent = '正在载入海港居民…';
    try { interactions = await createHarborInteractions({ scene, harbor, camera, renderer, canvas, orbit, visitingBoat,
      fish: underwaterActors, waterMaterial, waterLevel: WATER_LEVEL,
      lighthouse: [lighthouseLeft, lighthouseRight], moveToView, reducedMotion,
      cancelCameraMotion: () => { cameraMove = null; },
      restoreLighting: () => applyLightingMode(lightingMode),
      isWaterVisible: () => waterEnabled, isNight: () => nightEnabled });
    } catch(error) { console.error(error);setStatus('人物加载失败', 'error');assetState.textContent='人物加载失败，请重试';errorState.hidden=false;errorState.style.display='flex';return; }
    markLoad('interactions-ready');
    harbor.traverse(o=>{if(o.isMesh&&o.userData.needsImmersion)addImmersionTint(o);});
    updateControlState(document.querySelector('[data-control="night"]'), nightEnabled);
    const previewParams = new URLSearchParams(window.location.search);
    if (previewParams.get('view') === 'water') {
      camera.position.set(11, 9, 26);
      orbit.target.set(0, 1.5, .5);
      orbit.update();
    }
    if (previewParams.has('qa')) {
      window.__harborSceneQA=scene;
      window.__harborBenchQA=()=>benchRepair;
      window.__harborBatchQA=()=>batchReport;
      window.__harborPickQA = (x,y) => {
        const ray=new THREE.Raycaster();ray.layers.enable(1);ray.setFromCamera(new THREE.Vector2(x/innerWidth*2-1,1-y/innerHeight*2),camera);
        return ray.intersectObject(harbor,true).filter(h=>{for(let p=h.object;p;p=p.parent)if(!p.visible)return false;return true;}).slice(0,4).map(h=>({name:h.object.userData?.name||h.object.name,point:h.point.toArray(),parents:[h.object.parent?.name,h.object.parent?.parent?.name]}));
      };
      window.__harborInteractionsQA = () => interactions.inspect();
      window.__harborMotionQA = (command, args={}) => {
        if(command==='pause')qaElapsed=previousElapsed;
        if(command==='step')qaElapsed=interactions.qaStep(args.seconds||0,!!args.follow);
        if(command==='greet')interactions.qaGreet(args.id||'keeper');
        if(command==='camera'){
          cameraMove=null;orbit.enableDamping=false;orbit.update();orbit.minDistance=.1;
          camera.position.fromArray(args.position);orbit.target.fromArray(args.target);orbit.update();
        }
        return interactions.inspect();
      };
      window.__harborQA = (filter) => {
        const rows = [];
        harbor.updateMatrixWorld(true);
        harbor.traverse((object) => {
          const label = (object.userData?.name || object.name || '').replace(/_/g, ' ');
          if (!object.isMesh || !(filter ? new RegExp(filter,"i") : /painted hull|boat deck|piling|gangway support|V3.30 submerged stone|V3.30 pale sandy seabed|V3.30 exposed|Gently undulating water|Rounded walnut/i).test(label)) return;
          const box = new THREE.Box3().setFromObject(object);
          let visible = true;
          for (let node = object; node; node = node.parent) visible = visible && node.visible;
          rows.push({ name: label, visible, min: box.min.toArray(), max: box.max.toArray() });
        });
        return { waterline: WATER_LEVEL, seabed: SEABED_LEVEL, rows,
          materialRepair: materialRepairReport, practicalLightCount: practicalLights.length,
          night: nightEnabled, lightingMode, exposure: renderer.toneMappingExposure,
          keyIntensity: keyLight.intensity, hemisphereIntensity: hemisphereLight.intensity,
          practicalIntensity: practicalLights.reduce((sum,l)=>sum+l.intensity,0),
          waterVisible: waterEnabled, surfaceOpacity: waterMaterial.uniforms.uOpacity.value,
          bedVisible: waterBottom.visible, ripplesVisible: waterContacts.visible,
          immersionEnabled: contactUniforms.uWaterVisible.value, rippleCount: waterContacts.children.length,
          camera: camera.position.toArray(), target: orbit.target.toArray(), pixelRatio: renderer.getPixelRatio(),
          cameraMoving: !!cameraMove };
      };
    }
    lightingButtons.forEach((button) => { button.disabled = false; });
    errorState.hidden = true;
    errorState.style.display = 'none';
    loadReadout.textContent = '100%';
    loadBarFill.style.width = '100%';
    assetState.textContent = '实时场景已就绪';
    batchReport=batchHarborStatics(harbor);markLoad('static-batched');
    assetState.textContent='正在准备画面…';
    await renderer.compileAsync(scene,camera);markLoad('shaders-ready');
    readyToRender=true;
    markLoad('scene-ready');
    if (['keeper','fisher','visitor'].includes(previewParams.get('character'))) moveToView(previewParams.get('character'));
  }, (event) => {
    if (!event.total) return;
    const pct = Math.round((event.loaded / event.total) * 100);
    loadReadout.textContent = `${pct}%`;
    loadBarFill.style.width = `${pct}%`;
    assetState.textContent = pct < 100 ? '正在读取 Blender 场景…' : '正在解析场景…';
  }, (error) => {
    console.error(error);
    setStatus('加载失败', 'error');
    assetState.textContent = '模型读取失败';
    errorState.hidden = false;
    errorState.style.display = 'flex';
  });
}

function resetView() {
  moveToView('overview');
}

function moveToView(name) {
  // Clear the previous gesture's damping before a scripted camera move.
  const heldPosition = camera.position.clone(), heldTarget = orbit.target.clone();
  const damping = orbit.enableDamping;
  orbit.enableDamping = false; orbit.update();
  camera.position.copy(heldPosition); orbit.target.copy(heldTarget);
  orbit.enableDamping = damping; orbit.update();
  const mobile = window.innerWidth < 700;
  const views = {
    overview: { position: mobile ? [16.8,25.88,33.6] : [12.6,19.28,28.2], target: [0,2.6,0] },
    harbor: { position: mobile ? [9,12,23] : [8,10,18], target: [0,.8,2.5] },
    lighthouse: { position: mobile ? [10,14,18] : [8,12,14], target: [1.5,5,-2.8] },
  };
  const characterView = interactions?.characterView(name,mobile);
  const view = characterView || views[name] || views.overview;
  orbit.minDistance = characterView ? .55 : 9;
  cameraMove = { started: performance.now(), position: camera.position.clone(), target: orbit.target.clone(),
    toPosition: new THREE.Vector3(...view.position), toTarget: new THREE.Vector3(...view.target) };
  if (reducedMotion.matches) {
    camera.position.copy(cameraMove.toPosition); orbit.target.copy(cameraMove.toTarget); cameraMove = null;
    orbit.update();
  }
  document.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('selected', button.dataset.view === name);
    button.setAttribute('aria-pressed', String(button.dataset.view === name));
  });
}

function updateControlState(button, active) {
  button.classList.toggle('active', active);
  button.setAttribute('aria-pressed', String(active));
}

function handleControl(control) {
  if (control === 'reset') { resetView(); return; }
  if (control === 'sweep') {
    if (!lighthouseLeft || !lighthouseRight) return;
    sweepEnabled = !sweepEnabled;
    const sweepIntensity = lightingProfiles[lightingMode].sweep;
    lighthouseLeft.intensity = sweepEnabled ? sweepIntensity : 0;
    lighthouseRight.intensity = sweepEnabled ? sweepIntensity : 0;
    [lighthouseLeft, lighthouseRight].forEach((light) => { if (light?.beamMesh) light.beamMesh.visible = sweepEnabled && sweepIntensity > 0; });
    updateControlState(document.querySelector(`[data-control="${control}"]`), sweepEnabled);
  }
  if (control === 'water') {
    waterEnabled = !waterEnabled;
    if (waterMaterial) waterMaterial.uniforms.uOpacity.value = waterEnabled ? (nightEnabled ? .23 : .27) : 0;
    contactUniforms.uWaterVisible.value = waterEnabled ? 1 : 0;
    if (waterBottom) waterBottom.visible = waterEnabled;
    if (waterCaustics) waterCaustics.visible = waterEnabled;
    waterWalls.forEach((wall) => { wall.visible = waterEnabled; });
    importedUnderwaterDetails.forEach((detail) => { detail.visible = waterEnabled; });
    if (underwaterGroup) underwaterGroup.visible = waterEnabled;
    if (waterContacts) waterContacts.visible = waterEnabled;
    updateControlState(document.querySelector(`[data-control="${control}"]`), waterEnabled);
  }
  if (control === 'night') {
    nightEnabled = !nightEnabled;
    applyLightingMode(lightingMode);
    updateControlState(document.querySelector(`[data-control="${control}"]`), nightEnabled);
  }
}

function handleLightingMode(mode) {
  if (!renderer || !scene || !harbor) return;
  applyLightingMode(mode);
}

function animate() {
  requestAnimationFrame(animate);
  if (cameraMove) {
    const progress = Math.min(1, (performance.now() - cameraMove.started) / 1500);
    const smooth = progress * progress * (3 - 2 * progress);
    camera.position.lerpVectors(cameraMove.position, cameraMove.toPosition, smooth);
    orbit.target.lerpVectors(cameraMove.target, cameraMove.toTarget, smooth);
    if (progress === 1) cameraMove = null;
  }
  const elapsed = qaElapsed ?? clock.getElapsedTime();
  const dt = qaElapsed===null ? Math.min(.1, Math.max(0, elapsed - previousElapsed)) : 0;
  previousElapsed = elapsed;
  if (waterEnabled) contactUniforms.uWaterTime.value = elapsed;
  if (waterMaterial && waterEnabled) waterMaterial.uniforms.uTime.value = elapsed;
  if (waterCaustics && waterEnabled) waterCaustics.material.uniforms.uTime.value = elapsed;
  interactions?.update(elapsed, dt);
  if (lighthouseTargets && (sweepEnabled || interactions?.isGuiding())) {
    if (!interactions?.isGuiding()) {
      const sweep = Math.sin(elapsed * .52) * .78;
      lighthouseTargets[0].position.set(-12 * Math.cos(sweep), 4.6 + Math.sin(elapsed * .3) * .4, -3.5);
      lighthouseTargets[1].position.set(12 * Math.cos(sweep), 4.6 - Math.sin(elapsed * .3) * .3, -4.5);
    }
    [lighthouseLeft, lighthouseRight].forEach((light) => {
      if (!light?.beamMesh) return;
      const target = light.target.position;
      const direction = new THREE.Vector3().subVectors(target, light.position);
      const length = direction.length();
      light.beamMesh.position.copy(light.position).addScaledVector(direction.normalize(), length * .5);
      light.beamMesh.scale.set(1, length / 24, 1);
      // Cone tip is +Y; it belongs at the lamp, with the broad end away from it.
      light.beamMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().negate());
    });
  }
  orbit.update();
  if(harbor&&!readyToRender)return;
  const renderStart=performance.now();renderer.render(scene, camera);
  if(performance.now()-renderStart>200)loadMetrics.push({stage:'slow-render',ms:Math.round(performance.now()),duration:Math.round(performance.now()-renderStart)});
  if(interactions&&!renderedReady){
    renderedReady=true;markLoad('first-ready-frame');
    assetState.textContent='实时场景已就绪';setStatus('场景已就绪','ready');
    window.__harborRenderInfo={...renderer.info.render,programs:renderer.info.programs.length};
  }
}

function frameScene() {
  // Leave room below the island for the sound player without cropping the basin.
  const offset = window.innerWidth < 700 ? 0 : Math.round(window.innerHeight / 12);
  camera.setViewOffset(window.innerWidth, window.innerHeight, 0, offset, window.innerWidth, window.innerHeight);
}

function resize() {
  camera.fov = window.innerWidth < 700 ? 58 : 42;
  camera.aspect = window.innerWidth / window.innerHeight;
  frameScene();
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}

try {
  createRenderer();
  createScene();
  loadHarbor();
  controls.forEach((button) => button.addEventListener('click', () => handleControl(button.dataset.control)));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => moveToView(button.dataset.view)));
  document.querySelector('#quality').addEventListener('change', event => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityCaps[event.target.value] || 1.25));
    resize();
  });
  lightingButtons.forEach((button) => button.addEventListener('click', () => handleLightingMode(button.dataset.lighting)));
  window.addEventListener('resize', resize);
  animate();
} catch (error) {
  console.error(error);
  setStatus('浏览器不支持 WebGL', 'error');
  assetState.textContent = 'WebGL 初始化失败';
  errorState.hidden = false;
  errorState.style.display = 'flex';
}
