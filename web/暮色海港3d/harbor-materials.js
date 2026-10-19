import * as THREE from 'three';

// Blender BOX/Generated coordinates and procedural ColorRamps do not survive
// this GLB export. Rebuild usable UVs and a deliberate, stable PBR palette.
// Image luminance still supplies grain; it no longer dyes every surface brown.
export function repairHarborMaterials(root) {
  const cache = new Map();
  const geometryCache = new Set();
  const textureCache = new Map();
  const report = { uvMeshesRepaired: 0, materialsRepaired: 0, heightMapsRepaired: 0, textureChannelsRepaired: 0, palette: [] };
  const variants = (list, name) => list[Number(name.match(/(\d+)$/)?.[1] || 0) % list.length];
  function palette(name) {
    if (/warm ivory plaster/.test(name)) return ['#e4e1d2', .86];
    if (/keeper cottage apricot/.test(name)) return ['#bacabd', .85];
    if (/cafe seafoam plaster/.test(name)) return ['#a2bfb5', .85];
    if (/fisher house ochre/.test(name)) return ['#d4c3a4', .85];
    if (/boathouse blue gray/.test(name)) return ['#7d9ca8', .78];
    if (/limestone window trim/.test(name)) return ['#cfcebf', .83];
    if (/harbor limestone/.test(name)) return [variants(['#a9b2b5','#b4bbbc','#9eaaaf','#b8bebb','#a3b0b4','#c1c5bd'],name), .88];
    if (/coastal slate/.test(name)) return [variants(['#84939d','#909aa9','#7c8e9b','#9c9eac','#84999f'],name), .9];
    if (/old honey oak/.test(name)) return ['#a58964', .79];
    if (/weathered deck timber/.test(name)) return ['#a39378', .84];
    if (/enduring vertical grain oak/.test(name)) return ['#967c5d', .79];
    if (/natural hemp rope/.test(name)) return ['#c3b596', .9];
    if (/terracotta tile/.test(name)) return [variants(['#ac715c','#b98069','#a56955','#c08a70','#b47760','#a86f61'],name), .81];
    if (/slate roof tile/.test(name)) return [variants(['#607e91','#6e8b9b','#5b7589','#788d9c','#587a87'],name), .78];
    if (/headland moss/.test(name)) return ['#5b7952', .9];
    if (/coastal foliage/.test(name)) return [variants(['#486b48','#66835a','#53784f','#789461'],name), .9];
    if (/pocket beach sand/.test(name)) return ['#cbbd98', .92];
    return null;
  }
  root.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const hasMap = materials.some(m => m.map || m.roughnessMap || m.normalMap);
    const geometry = object.geometry;
    if (hasMap && !geometry.attributes.uv && !geometryCache.has(geometry)) {
      geometryCache.add(geometry);
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      const pos=geometry.attributes.position, normals=geometry.attributes.normal;
      const coords = new Float32Array(pos.count*2);
      for(let i=0;i<pos.count;i++) {
        const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
        const nx=Math.abs(normals.getX(i)),ny=Math.abs(normals.getY(i)),nz=Math.abs(normals.getZ(i));
        const uv=ny>=nx && ny>=nz?[x,z]:nx>=nz?[z,y]:[x,y];
        coords[i*2]=uv[0]*.72;coords[i*2+1]=uv[1]*.72;
      }
      geometry.setAttribute('uv',new THREE.BufferAttribute(coords,2));
      report.uvMeshesRepaired++;
    }
    const fixed=materials.map((original) => {
      if(cache.has(original)) return cache.get(original);
      const name=original.name.toLowerCase(), spec=palette(name);
      const mat=original.clone();cache.set(original,mat);
      for(const key of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap']) {
        const texture=mat[key];if(!texture)continue;
        if(texture.channel!==0) {
          if(!textureCache.has(texture)) {
            const copy=texture.clone();copy.channel=0;copy.needsUpdate=true;
            textureCache.set(texture,copy);report.textureChannelsRepaired++;
          }
          mat[key]=textureCache.get(texture);
        }
      }
      // Exported Blender Bump nodes carry scalar *_disp images. Treating
      // grayscale heights as tangent-space RGB normals creates black facets.
      if(mat.normalMap && /disp|height/i.test(mat.normalMap.name)) {
        mat.bumpMap=mat.normalMap;mat.normalMap=null;
        mat.bumpScale=/slate|limestone/.test(name)?.022:.009;
        report.heightMapsRepaired++;
      }
      if(spec) {
        mat.color.set(spec[0]);mat.roughness=spec[1];mat.metalness=0;
        if(mat.normalScale)mat.normalScale.multiplyScalar(.35);
        mat.onBeforeCompile=(shader) => {
          shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>', `
            #ifdef USE_MAP
              vec4 detailSample=texture2D(map,vMapUv);
              float grain=clamp(dot(detailSample.rgb,vec3(.2126,.7152,.0722))/.28,.60,1.35);
              diffuseColor.rgb*=mix(1.0,grain,.32);
              diffuseColor.a*=detailSample.a;
            #endif
          `);
        };
        mat.customProgramCacheKey=()=> 'harbor-palette-grain-332';
        report.materialsRepaired++;
        report.palette.push({name:original.name,color:spec[0]});
      }
      return mat;
    });
    object.material=Array.isArray(object.material)?fixed:fixed[0];
  });
  return report;
}
