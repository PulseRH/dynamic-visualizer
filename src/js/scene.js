// Three.js scene: the image as a depth-layered point cloud, displaced by
// audio-driven waves in the vertex shader. One draw call for the cloud,
// one for the backdrop. Per-frame CPU cost = a handful of uniform writes.

import * as THREE from '../vendor/three.module.js';

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uEnergy;
  uniform float uBeat;
  uniform float uIntensity;
  uniform float uDepthScale;
  uniform float uAspect;
  uniform float uSize;
  uniform float uCamZ;
  uniform float uMode;
  uniform float uBandMap;
  uniform float uBandCount;
  uniform float uInvert;
  uniform float uBoost;
  uniform float uSizeComp;
  uniform float uZMove;
  uniform float uXYMove;
  uniform float uVis;
  uniform float uExitPush;
  uniform vec3 uCursor;   // xy = cursor position in world space, z = ripple strength
  uniform sampler2D uBands;

  attribute vec3 aColor;
  attribute float aRand;

  varying vec3 vColor;
  varying float vAmp;

  void main() {
    float near = position.z;                 // 0..1, 1 = closest to viewer
    vec2 uvw = vec2(position.x / uAspect + 0.5, position.y + 0.5);

    // which region of the image listens to which frequency band:
    // 0 = by depth layer, 1 = radial from center, 2 = bottom->top, 3 = left->right
    float bt;
    if (uBandMap < 0.5) {
      bt = near;
    } else if (uBandMap < 1.5) {
      bt = clamp(distance(uvw, vec2(0.5)) * 1.25, 0.0, 1.0);   // center = bass, edges = highs
    } else if (uBandMap < 2.5) {
      bt = 1.0 - uvw.y;                                         // ground = bass, sky = highs
    } else {
      bt = uvw.x;                                               // left = bass, right = highs
    }
    if (uInvert > 0.5) bt = 1.0 - bt;   // swap bass <-> highs direction
    float band = clamp(floor(bt * uBandCount), 0.0, uBandCount - 1.0);
    // already shaped by the analyzer (gain -> floor -> curve)
    float amp = texture2D(uBands, vec2((band + 0.5) / uBandCount, 0.5)).r;
    float lightAmp = amp;                     // no global dimming: quiet
                                              // regions keep their base light

    float w;
    if (uMode < 0.5) {
      // traveling wave across the image
      w = sin(uTime * 1.7 + uvw.x * 7.0 + near * 5.0 + aRand * 0.7);
    } else if (uMode < 1.5) {
      // radial ripple from the center
      float d = distance(uvw, vec2(0.5));
      w = sin(d * 16.0 - uTime * 3.1 + near * 3.0) * (1.0 - d * 0.55);
    } else if (uMode < 2.5) {
      // horizontal slices pulsing like bars
      float row = floor(uvw.y * 28.0);
      w = sin(uTime * 2.2 + row * 0.9) * 0.75 + sin(uTime * 5.3 + row * 2.1) * 0.25;
    } else if (uMode < 3.5) {
      // slow ambient drift (nice at idle / low energy)
      w = sin(uvw.x * 9.0 + uTime * 0.5) * sin(uvw.y * 7.0 - uTime * 0.42) * 1.3
        + sin(uTime * 0.8 + aRand * 6.2831) * 0.45;
    } else {
      // pure audio: no self-motion at all — the spectrum alone displaces
      w = 1.0;
    }

    float disp = w * amp * uIntensity * uZMove * 0.11 * (0.35 + 0.65 * near);
    disp += uBeat * 0.035 * uZMove * (0.15 + near);   // kicks push the cloud forward

    vec3 pos = vec3(position.xy, near * uDepthScale + disp);
    pos.xy += vec2(sin(uTime * 3.1 + aRand * 40.0), cos(uTime * 2.6 + aRand * 30.0))
            * amp * 0.006 * uIntensity * uXYMove;
    pos.xy *= 1.0 + uBeat * 0.012 * uXYMove;
    // idle exit: 'fly-by' rush points toward the camera as they fade;
    // the default clean fade just dissolves in place
    pos.z += (1.0 - uVis) * uExitPush;

    // cursor ripple: a soft radial swell that follows the mouse
    float cd = distance(pos.xy, uCursor.xy);
    float ripple = exp(-cd * cd * 4.0) * uCursor.z;
    pos.z += ripple * 0.1;
    pos.xy += (pos.xy - uCursor.xy) * ripple * 0.05;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float ps = uSize * (1.0 + amp * 0.9 + uBeat * 0.4) * (uCamZ / -mv.z);
    gl_PointSize = clamp(ps, 0.75, 24.0);

    vAmp = lightAmp;
    // every particle stays visible at base brightness; the loud/moving ones
    // brighten on top, and dark particles catch a cool shimmer
    float lum = max(aColor.r, max(aColor.g, aColor.b));
    vec3 lit = aColor * (0.78 + uBoost * lightAmp)
             + vec3(0.07, 0.09, 0.13) * lightAmp * (1.0 - lum) * 0.7;
    // normalize for point size: bigger points overlap more, so dim per point
    lit *= uSizeComp;
    // points nearer the camera cover more screen: dim them the same way
    lit /= sqrt(max(uCamZ / -mv.z, 0.5));
    vColor = lit;
  }
`;

const FRAG = /* glsl */ `
  uniform float uGlow;
  uniform float uVis;
  varying vec3 vColor;
  varying float vAmp;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d2 = dot(c, c);
    if (d2 > 0.25) discard;
    float a = smoothstep(0.25, 0.06, d2);
    gl_FragColor = vec4(vColor * uGlow * uVis * a, a);   // premultiplied for additive
  }
`;

const BACKDROP_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BACKDROP_FRAG = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uDim;
  uniform float uAspect;
  varying vec2 vUv;
  void main() {
    vec3 col = texture2D(uTex, vUv).rgb;
    gl_FragColor = vec4(col * uDim, 1.0);
  }
`;

const MODES = { wave: 0, ripple: 1, bands: 2, drift: 3, audio: 4 };
const BAND_MAPS = { depth: 0, radial: 1, vertical: 2, horizontal: 3 };

export class VisualScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x000000, 1);
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.quality = 1; // adaptive multiplier on pixel ratio

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 40);
    this.camBaseZ = 1.9;
    this.camera.position.set(0, 0, this.camBaseZ);

    this.time = 0;
    this.lastNow = performance.now();
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };

    // spectrum texture (RGBA8, width = band count, user-configurable)
    this.bandCount = 64;
    this.bandData = new Uint8Array(this.bandCount * 4);
    this.bandTex = new THREE.DataTexture(this.bandData, this.bandCount, 1, THREE.RGBAFormat);
    this.bandTex.magFilter = THREE.NearestFilter;
    this.bandTex.minFilter = THREE.NearestFilter;
    this.bandTex.needsUpdate = true;

    this.uniforms = {
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uBeat: { value: 0 },
      uIntensity: { value: 1 },
      uDepthScale: { value: 0.35 },
      uAspect: { value: 1 },
      uSize: { value: 2 },
      uCamZ: { value: 1.4 },
      uMode: { value: 1 },
      uBandMap: { value: 1 },
      uBandCount: { value: 64 },
      uInvert: { value: 0 },
      uBoost: { value: 1 },
      uSizeComp: { value: 1 },
      uZMove: { value: 1 },
      uXYMove: { value: 1 },
      uVis: { value: 1 },
      uExitPush: { value: 0 },
      uCursor: { value: new THREE.Vector3(0, 0, 0) },
      uGlow: { value: 1.1 },
      uBands: { value: this.bandTex },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });

    this.points = null;
    this.backdrop = null;
    this.cloudAspect = 16 / 9;

    this._resize();
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('pointermove', (e) => {
      this.pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    });
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.basePixelRatio * this.quality);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._fitCamera();
    this._layoutBackdrop();
  }

  _fitCamera() {
    // COVER fit: keep the image's square pixels and zoom until it fills the
    // screen, cropping overflow — like background-size: cover. Overscan adds
    // extra zoom so parallax offsets never reveal an edge.
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dH = 0.5 / halfH;                                       // height just fills
    const dW = (this.cloudAspect / 2) / (halfH * this.camera.aspect); // width just fills
    this.camBaseZ = Math.min(dH, dW) / (this.overscan || 1);
  }

  _layoutBackdrop() {
    if (!this.backdrop) return;
    // Pixel-lock the backdrop to the cloud: the cloud's world footprint is
    // (cloudAspect × 1) at distance camBaseZ; the backdrop sits 0.02 farther,
    // so scaling its footprint by (camBaseZ + 0.02) / camBaseZ × overscan
    // projects it onto exactly the same screen rect as the particles.
    const k = ((this.camBaseZ + 0.02) / this.camBaseZ) * (this.overscan || 1);
    this.backdrop.scale.set(this.cloudAspect * k, k, 1);
  }

  /** rebuild geometry from sampled cloud arrays */
  setCloud(cloud) {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points = null;
    }
    this.cloudAspect = cloud.aspect;
    this.uniforms.uAspect.value = cloud.aspect;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(cloud.colors, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(cloud.rands, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0.4), Math.max(cloud.aspect, 1));

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    // world spacing between points -> density-aware pixel size for the shader
    const rows = Math.max(1, Math.round(Math.sqrt(cloud.count / cloud.aspect)));
    this.spacingWorld = 1 / rows;
    this._fitCamera();
    this._layoutBackdrop();
  }

  /** external pointer feed (wallpaper windows track the global cursor) */
  setExternalPointer(nx, ny) {
    this.pointer.tx = nx;
    this.pointer.ty = ny;
  }

  /** idle envelope: 1 = particles live, 0 = plain wallpaper (audio silent).
   *  The cloud fades on this envelope; the wallpaper chases it on a slower
   *  curve, so the points are fully gone before the image reaches full
   *  opacity. backdropSettled() reports when that rise has completed. */
  setIdleVis(v, dtMs = 16) {
    this.idleVis = v;
    this.uniforms.uVis.value = v;
    if (this.backdrop && !this.backdrop.isDestroyed) {
      const base = this.hideBackdrop ? 0 : this.backdropBaseDim;
      const target = base + (1 - base) * (1 - v);
      if (!Number.isFinite(this.backdropDim)) this.backdropDim = target;
      if (Math.abs(target - this.backdropDim) < 0.01) {
        this.backdropDim = target; // settled
      } else {
        // rise gently when going idle, clear quickly when music returns
        const tau = target > this.backdropDim ? 300 : 150;
        this.backdropDim += (target - this.backdropDim) * (1 - Math.exp(-Math.max(1, dtMs) / tau));
      }
      this.backdrop.material.uniforms.uDim.value = this.backdropDim;
    }
  }

  /** true when the wallpaper image has finished its rise after the points left */
  backdropSettled() {
    if (!this.backdrop || this.backdrop.isDestroyed) return true;
    const base = this.hideBackdrop ? 0 : this.backdropBaseDim;
    const target = base + (1 - base) * (1 - this.idleVis);
    return Math.abs(this.backdropDim - target) < 0.005;
  }

  /** dim image backdrop ('black' | 'dim' | 'off') */
  setBackdrop(bitmapOrCanvas, mode) {
    if (this.backdrop) {
      this.scene.remove(this.backdrop);
      this.backdrop.material.dispose();
      this.backdrop = null;
    }
    if (mode === 'off' || !bitmapOrCanvas) {
      this.renderer.setClearColor(0x000000, 1);
      return;
    }
    // Texture.flipY has no effect for ImageBitmap sources (three.js uploads
    // them as-is), so route them through a canvas to get correct orientation.
    let source = bitmapOrCanvas;
    if (typeof ImageBitmap !== 'undefined' && bitmapOrCanvas instanceof ImageBitmap) {
      const c = document.createElement('canvas');
      c.width = bitmapOrCanvas.width;
      c.height = bitmapOrCanvas.height;
      c.getContext('2d').drawImage(bitmapOrCanvas, 0, 0);
      source = c;
    }
    // never hold a texture larger than the display it fills — a 4K source on
    // a 1440p screen would waste ~20MB per window for invisible detail
    const maxW = this.renderer.domElement.width || 1920;
    const maxH = this.renderer.domElement.height || 1080;
    if (source.width > maxW || source.height > maxH) {
      const scale = Math.min(maxW / source.width, maxH / source.height);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(source.width * scale));
      c.height = Math.max(1, Math.round(source.height * scale));
      c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
      source = c;
    }
    const tex = new THREE.CanvasTexture(source);
    // sample in display space — our shaders write raw values to the framebuffer
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uDim: { value: mode === 'dim' ? 0.17 : 0 }, uAspect: { value: 1 } },
      vertexShader: BACKDROP_VERT,
      fragmentShader: BACKDROP_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.backdrop.position.z = -0.02;
    this.backdrop.renderOrder = -1;
    this.backdrop.frustumCulled = false;
    this.backdropBaseDim = mode === 'dim' ? 0.17 : 0;
    this.backdropDim = this.backdropBaseDim; // matches target for idleVis = 1
    this.scene.add(this.backdrop);
    this.setIdleVis(this.idleVis ?? 1); // apply the current idle envelope
    this._layoutBackdrop();
  }

  setBandCount(n) {
    n = Math.max(4, Math.min(256, Math.round(n)));
    if (n === this.bandCount) return;
    this.bandCount = n;
    this.bandData = new Uint8Array(n * 4);
    this.bandTex.dispose();
    this.bandTex = new THREE.DataTexture(this.bandData, n, 1, THREE.RGBAFormat);
    this.bandTex.magFilter = THREE.NearestFilter;
    this.bandTex.minFilter = THREE.NearestFilter;
    this.bandTex.needsUpdate = true;
    this.uniforms.uBands.value = this.bandTex;
    this.uniforms.uBandCount.value = n;
  }

  applySettings(s) {
    this.uniforms.uIntensity.value = s.intensity;
    this.uniforms.uDepthScale.value = s.depthScale;
    this.uniforms.uMode.value = MODES[s.waveMode] ?? 1;
    this.uniforms.uBandMap.value = BAND_MAPS[s.bandMap] ?? 0;
    this.uniforms.uInvert.value = s.invertBands ? 1 : 0;
    this.uniforms.uGlow.value = s.glow;
    this.uniforms.uBoost.value = s.boost;
    this.uniforms.uZMove.value = s.depthMove;
    this.uniforms.uXYMove.value = s.xyMove;
    this.overscan = s.overscan;
    this.hideBackdrop = !!s.hideBackdrop;
    this.cursorRipple = !!s.cursorRipple;
    this.uniforms.uExitPush.value = s.flybyExit ? 0.4 : 0;
    this.setBandCount(s.bands);
    // size compensation: additive brightness ∝ point area (diameter²),
    // normalized so size ≈ 1 (diameter = spacing) is the reference look
    this.uniforms.uSizeComp.value =
      1 / THREE.MathUtils.clamp(s.pointSize * s.pointSize, 0.35, 6);
    this.pointSizeSetting = s.pointSize;
    // 'audio' mode = zero autonomous motion: no camera drift, spectrum only
    this.autoMotion = s.waveMode !== 'audio';
    this._fitCamera();
    this._layoutBackdrop();
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.setPixelRatio(this.basePixelRatio * this.quality);
  }

  /** one frame; audio analyzer supplies bands/energy/beat. dt is clamped. */
  render(analyzer, parallaxStrength) {
    const now = performance.now();
    let dt = (now - this.lastNow) / 1000;
    this.lastNow = now;
    dt = Math.min(dt, 0.05);
    this.time += dt;

    const bands = analyzer.bands;
    const count = Math.min(this.bandCount, bands.length);
    for (let i = 0; i < count; i++) {
      const v = Math.min(255, bands[i] * 255) | 0;
      this.bandData[i * 4] = v;
      this.bandData[i * 4 + 1] = v;
      this.bandData[i * 4 + 2] = v;
      this.bandData[i * 4 + 3] = 255;
    }
    this.bandTex.needsUpdate = true;

    this.uniforms.uTime.value = this.time;
    this.uniforms.uEnergy.value = analyzer.energy;
    this.uniforms.uBeat.value = analyzer.beat;

    // point size in pixels when the cloud is at rest distance:
    //   pointSize=1.0 means a point's diameter equals the point spacing
    const hPx = this.renderer.domElement.height; // drawing-buffer pixels
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.uniforms.uSize.value =
      (this.pointSizeSetting || 1) * hPx * (this.spacingWorld || 1 / 300)
      / (2 * tanHalf * this.camBaseZ);
    this.uniforms.uCamZ.value = this.camBaseZ;

    // pointer parallax is always available (it's user-driven); the autonomous
    // drift is suppressed in 'audio' mode
    const p = parallaxStrength * 0.06;
    const drift = this.autoMotion ? 1 : 0;
    this.pointer.x += (this.pointer.tx - this.pointer.x) * Math.min(1, dt * 3);
    this.pointer.y += (this.pointer.ty - this.pointer.y) * Math.min(1, dt * 3);
    const t = this.time;
    this.camera.position.x = Math.sin(t * 0.13) * p * 0.6 * drift + this.pointer.x * p;
    this.camera.position.y = Math.cos(t * 0.11) * p * 0.4 * drift - this.pointer.y * p * 0.6;

    // cursor ripple: strength rises with cursor speed, decays when it stops
    const spd = Math.hypot(this.pointer.tx - (this._prevNx ?? 0), this.pointer.ty - (this._prevNy ?? 0)) / Math.max(dt, 0.001);
    this._prevNx = this.pointer.tx;
    this._prevNy = this.pointer.ty;
    this.cursorStrength = Math.min(1, (this.cursorStrength ?? 0) * Math.exp(-dt / 0.3) + spd * 0.12);
    const rippleOn = this.cursorRipple ? 1 : 0;
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camBaseZ;
    this.uniforms.uCursor.value.set(
      this.pointer.x * halfH * this.camera.aspect * 2,
      -this.pointer.y * halfH * 2,
      this.cursorStrength * rippleOn,
    );
    this.camera.position.z = this.camBaseZ + analyzer.beat * 0.02;
    this.camera.lookAt(0, 0, 0.1);

    this.renderer.render(this.scene, this.camera);
    return dt;
  }
}
