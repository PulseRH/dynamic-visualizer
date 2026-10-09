import * as THREE from '../vendor/three.module.js';

// A shared projected depth mask catches walls belonging to another slice.
// Only emitted sidewall strips are included; no AI or per-frame CPU sampling.
export class SideMask {
  constructor(vertexShader, uniforms) {
    this.uniforms=uniforms;
    this.size=new THREE.Vector2();this.clearColor=new THREE.Color();
    this.scene=new THREE.Scene();
    this.material=new THREE.ShaderMaterial({
      uniforms,vertexShader,defines:{GAP_FILL:1,SIDE_MASK:1},
      fragmentShader:`#include <packing>
        varying float vMaskOpen;
        void main(){if(vMaskOpen<.5)discard;gl_FragColor=packDepthToRGBA(gl_FragCoord.z);}`,
      side:THREE.DoubleSide,depthTest:true,depthWrite:true,blending:THREE.NoBlending,
    });
    Object.assign(this.material.defaultAttributeValues,{aColor:[1,1,1],aRand:[.5]});
    const texture=new THREE.DataTexture(new Uint8Array(4),1,1);
    texture.needsUpdate=true;this.empty=texture;
    uniforms.uSideMask={value:texture};uniforms.uSideMaskEnabled={value:0};
  }
  setGeometry(data) {
    if(this.mesh){this.scene.remove(this.mesh);this.mesh.geometry.dispose();this.mesh=null;}
    if(!data?.t.length){this.releaseTarget();return;}
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(data.t.length*3),3));
    for(const [name,key,size] of [['aFillStart','starts',4],['aFillEnd','ends',4],['aFillT','t',1],['aFillThickness','thickness',2],['aFillForeground','foreground',4]])geometry.setAttribute(name,new THREE.BufferAttribute(data[key],size));
    geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
    this.mesh=new THREE.Mesh(geometry,this.material);this.mesh.frustumCulled=false;this.scene.add(this.mesh);
  }
  releaseTarget() {
    this.target?.dispose();this.target=null;
    this.uniforms.uSideMask.value=this.empty;this.uniforms.uSideMaskEnabled.value=0;
  }
  render(renderer,camera,active) {
    if(!active || !this.mesh){this.releaseTarget();return;}
    const size=renderer.getDrawingBufferSize(this.size);
    // Half resolution, capped at 1536 on the long edge. The mask has no
    // lighting/textures, and the depth attachment exists only while in use.
    const scale=Math.min(.5,1536/Math.max(size.x,size.y));
    const w=Math.max(1,Math.ceil(size.x*scale)),h=Math.max(1,Math.ceil(size.y*scale));
    if(!this.target){this.target=new THREE.WebGLRenderTarget(w,h,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true,stencilBuffer:false});this.target.texture.generateMipmaps=false;}
    else if(this.target.width!==w || this.target.height!==h)this.target.setSize(w,h);
    const previous=renderer.getRenderTarget(),clear=renderer.getClearColor(this.clearColor),alpha=renderer.getClearAlpha();
    const auto=renderer.autoClear,depth=renderer.autoClearDepth;
    try{
      renderer.setRenderTarget(this.target);renderer.setClearColor(0,0);
      renderer.autoClear=false;renderer.clear(true,true,false);renderer.render(this.scene,camera);
    }finally{
      renderer.setRenderTarget(previous);renderer.setClearColor(clear,alpha);renderer.autoClear=auto;renderer.autoClearDepth=depth;
    }
    this.uniforms.uSideMask.value=this.target.texture;this.uniforms.uSideMaskEnabled.value=1;
  }
}
