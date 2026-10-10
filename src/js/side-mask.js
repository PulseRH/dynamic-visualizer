import * as THREE from '../vendor/three.module.js';

// A shared projected depth mask catches walls belonging to another slice.
// Emitted sidewall strips plus optional bounded front-surface splats.
// Sampling is cached; no AI or per-frame CPU sampling.
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
    this.faceMaterial=new THREE.ShaderMaterial({
      uniforms,vertexShader,defines:{SIDE_MASK:1},
      fragmentShader:`#include <packing>
        varying float vMaskOpen;
        void main(){if(vMaskOpen<.5 || distance(gl_PointCoord,vec2(.5))>.5)discard;gl_FragColor=packDepthToRGBA(gl_FragCoord.z);}`,
      depthTest:true,depthWrite:true,blending:THREE.NoBlending,
    });
    Object.assign(this.faceMaterial.defaultAttributeValues,{aColor:[1,1,1],aMaskOffset:[0,0]});
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
    const offsets=new Float32Array(data.t.length*2);
    for(let q=0;q<data.t.length;q+=4){
      const cx=(data.starts[q*4]+data.starts[(q+2)*4])*.5,cy=(data.starts[q*4+1]+data.starts[(q+2)*4+1])*.5;
      for(let i=q;i<q+4;i++){offsets[i*2]=data.starts[i*4]-cx;offsets[i*2+1]=data.starts[i*4+1]-cy;}
    }
    geometry.setAttribute('aMaskOffset',new THREE.BufferAttribute(offsets,2));
    geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
    this.mesh=new THREE.Mesh(geometry,this.material);this.mesh.frustumCulled=false;this.scene.add(this.mesh);
  }
  setFaces(cloud) {
    if(this.faces){this.scene.remove(this.faces);this.faces.geometry.dispose();this.faces=null;}
    this.faceSource={positions:cloud.positions,rands:cloud.rands,count:cloud.baseCount ?? cloud.count,aspect:cloud.aspect};
  }
  prepareFaces() {
    if(this.faces || !this.faceSource?.count)return;
    const {positions,rands,count,aspect}=this.faceSource,budget=Math.min(60000,count);
    const cols=Math.max(1,Math.min(budget,Math.floor(Math.sqrt(budget*aspect)))),rows=Math.max(1,Math.floor(budget/cols));
    const cells=new Int32Array(cols*rows).fill(-1),scores=new Float32Array(cells.length).fill(Infinity);
    // Choose one existing point nearest each coarse cell centre. This keeps
    // the actual depth/random phase; it creates no invented foreground surface.
    for(let i=0;i<count;i++){
      const x=(positions[i*3]/aspect+.5)*cols,y=(positions[i*3+1]+.5)*rows;
      const cx=Math.max(0,Math.min(cols-1,Math.floor(x))),cy=Math.max(0,Math.min(rows-1,Math.floor(y))),cell=cy*cols+cx;
      const score=(x-cx-.5)**2+(y-cy-.5)**2,old=cells[cell];
      if(score<scores[cell] || (score===scores[cell] && old>=0 && positions[i*3+2]>positions[old*3+2])){cells[cell]=i;scores[cell]=score;}
    }
    const selected=cells.filter(i=>i>=0),points=new Float32Array(selected.length*3),phases=new Float32Array(selected.length);
    selected.forEach((i,j)=>{points.set(positions.subarray(i*3,i*3+3),j*3);phases[j]=rands[i];});
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(points,3));geometry.setAttribute('aRand',new THREE.BufferAttribute(phases,1));
    this.faces=new THREE.Points(geometry,this.faceMaterial);this.faces.frustumCulled=false;this.scene.add(this.faces);
    this.uniforms.uSideMaskFaceSpacing.value=Math.max(aspect/cols,1/rows);
  }
  releaseTarget() {
    this.target?.dispose();this.target=null;
    this.uniforms.uSideMask.value=this.empty;this.uniforms.uSideMaskEnabled.value=0;
  }
  render(renderer,camera,active) {
    const faces=active && this.uniforms.uSideMaskFaceCoverage.value>0;
    if(faces)this.prepareFaces();
    if(this.faces)this.faces.visible=faces;
    if(!active || (!this.mesh && !this.faces?.visible)){this.releaseTarget();return;}
    const size=renderer.getDrawingBufferSize(this.size);
    // Half resolution, capped at 1536 on the long edge. The mask has no
    // lighting/textures, and the depth attachment exists only while in use.
    const scale=Math.min(.5,1536/Math.max(size.x,size.y));
    const w=Math.max(1,Math.ceil(size.x*scale)),h=Math.max(1,Math.ceil(size.y*scale));
    this.uniforms.uSideMaskHeight.value=h;
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
