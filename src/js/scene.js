// Three.js scene: the image as a depth-layered point cloud, displaced by
// audio-driven waves in the vertex shader. One draw call for the cloud,
// one for the backdrop. Per-frame CPU cost = a handful of uniform writes.

import * as THREE from '../vendor/three.module.js';
import { movementResponse } from './response.js';
import { buildHueLookup, buildHueAngleLookup, HueAccentTracker, HueCycleTracker } from './hue.js';
import { backdropTextureSize } from './backdrop-size.js';

const VERT = /* glsl */ `
  uniform float uEnergy;
  uniform float uIntensity;
  uniform float uDepthScale;
  uniform float uAspect;
  uniform float uSize;
  uniform float uCamZ;
  uniform vec4 uLayers; // wave, ripple, bands, drift
  uniform vec4 uExtraLayers; // swirl, breathe, sweep, band shake
  uniform float uBandMap;
  uniform float uBandCount;
  uniform float uInvert;
  uniform float uLightPulse;
  uniform float uLightFollowMotion;
  uniform float uSizePulse;
  uniform float uVibrancyPulse;
  uniform float uPreserveBoostColor;
  uniform float uHueEnabled;
  uniform float uSizeComp;
  uniform float uZMove;
  uniform float uXYMove;
  uniform float uXYTime;   // xy-motion clock, runs faster with volume
  uniform float uWaveTime; // wave-phase clock, also volume-ramped
  uniform float uCentered; // 1: audio mode displaces around rest (both ways)
  uniform float uEqualDepthMovement; // 1: audio depth range is independent of layer depth
  uniform float uDyn;      // Dynamics slider: loud passages move more
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
    vec4 bandSample = texture2D(uBands, vec2((band + 0.5) / uBandCount, 0.5));
    float amp = bandSample.r;
    float lightAmp = amp;                     // no global dimming: quiet
                                              // regions keep their base light

    float direct = mix(1.0, amp * 2.0 - 0.8, uCentered);
    float w = direct;
    // Uniform branches skip every disabled layer. Normalize the combined
    // depth overlay so stacking styles leaves the direct response intact.
    float style = 0.0;
    float layerTotal = dot(uLayers, vec4(1.0)) + uExtraLayers.z;
    if (uLayers.x > 0.0) {
      // traveling wave across the image
      style += uLayers.x * sin(uWaveTime * 1.7 + uvw.x * 7.0 + near * 5.0 + aRand * 0.7);
    }
    if (uLayers.y > 0.0) {
      // radial ripple from the center
      float d = distance(uvw, vec2(0.5));
      style += uLayers.y * sin(d * 16.0 - uWaveTime * 3.1 + near * 3.0) * (1.0 - d * 0.55);
    }
    if (uLayers.z > 0.0) {
      // horizontal slices pulsing like bars
      float row = floor(uvw.y * 28.0);
      style += uLayers.z * (sin(uWaveTime * 2.2 + row * 0.9) * 0.75 + sin(uWaveTime * 5.3 + row * 2.1) * 0.25);
    }
    if (uLayers.w > 0.0) {
      // slow ambient drift (nice at idle / low energy)
      float drift = sin(uvw.x * 9.0 + uWaveTime * 0.5) * sin(uvw.y * 7.0 - uWaveTime * 0.42) * 1.3
        + sin(uWaveTime * 0.8 + aRand * 6.2831) * 0.45;
      style += uLayers.w * clamp(drift, -1.0, 1.0);
    }
    if (uExtraLayers.z > 0.0) {
      style += uExtraLayers.z * sin((uvw.x + uvw.y) * 11.0 - uWaveTime * 2.0 + near * 2.0);
    }
    w = direct + style / max(1.0, layerTotal) * 0.65;

    float depthRange = mix(0.35 + 0.65 * near, 1.0, uEqualDepthMovement);
    float disp = w * amp * uIntensity * uZMove * 0.11 * depthRange * uDyn;

    vec3 pos = vec3(position.xy, near * uDepthScale + disp);
    pos.xy += vec2(sin(uXYTime * 3.1 + aRand * 40.0), cos(uXYTime * 2.6 + aRand * 30.0))
            * amp * 0.006 * uIntensity * uXYMove * uDyn;
    // Explicit layers have their own amounts; XY move controls the original
    // shimmer only. Apply a true rotation and scale so their shapes remain
    // clear and adding Breathe cannot dilute Swirl (or vice versa).
    vec2 layeredXY = position.xy;
    float layerDrive = amp * min(uIntensity * uDyn, 1.5);
    float lightStyle = style;
    float lightTotal = layerTotal;
    if (uExtraLayers.x > 0.0) {
      float swirlPhase = sin(uWaveTime * 0.8 + length(position.xy) * 4.0 + near * 1.2);
      float turn = swirlPhase * uExtraLayers.x * layerDrive * 0.112; // new maximum = former 28%
      float c = cos(turn), s = sin(turn);
      layeredXY = vec2(c * layeredXY.x - s * layeredXY.y,
                       s * layeredXY.x + c * layeredXY.y);
      if (uLightFollowMotion > 0.5) {
        lightStyle += swirlPhase * uExtraLayers.x;
        lightTotal += uExtraLayers.x;
      }
    }
    if (uExtraLayers.y > 0.0) {
      float breathePhase = sin(uWaveTime * 1.4 + near * 1.2);
      float swell = breathePhase * uExtraLayers.y * layerDrive * 0.2;
      layeredXY *= 1.0 + swell;
      if (uLightFollowMotion > 0.5) {
        lightStyle += breathePhase * uExtraLayers.y;
        lightTotal += uExtraLayers.y;
      }
    }
    pos.xy += layeredXY - position.xy;
    if (uLightFollowMotion > 0.5 && uLightPulse > 0.0 && lightTotal > 0.0) {
      // Shape only the extra light, never the resting image/glow. Keep the
      // original band's level and peak brightness; stronger layer mixes
      // reveal more pattern rather than multiplying brightness when stacked.
      float pattern = 0.6 + 0.4 * clamp(lightStyle / lightTotal, -1.0, 1.0);
      lightAmp *= mix(1.0, pattern, min(lightTotal, 1.0));
    }
    if (uExtraLayers.w > 0.0) {
      // Every point mapped to this band receives exactly the same vector.
      // Smooth, distinct phases give bands their own motion without flicker.
      float phase = band * 2.399963;
      vec2 shake = vec2(sin(uXYTime * 4.3 + phase),
                        sin(uXYTime * 5.7 + phase * 1.37 + 1.1));
      // Square band level to reserve the bigger shakes for loud peaks.
      // A curved amount also gives the lower half of the slider finer control.
      float shakeDrive = amp * layerDrive;
      float shakeAmount = uExtraLayers.w * uExtraLayers.w;
      pos.xy += shake * shakeAmount * shakeDrive * 0.045;
    }
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

    float ps = uSize * (1.0 + amp * 0.9 * uSizePulse) * (uCamZ / -mv.z);
    gl_PointSize = clamp(ps, 0.75, 24.0);

    vAmp = lightAmp;
    // every particle stays visible at base brightness; the loud/moving ones
    // brighten on top, and dark particles catch a cool shimmer
    float lum = max(aColor.r, max(aColor.g, aColor.b));
    float extraLight = uLightPulse * lightAmp;
    float shimmer = 1.0;
    if (uPreserveBoostColor > 0.5) {
      // Soften only the extra audio light, leaving the base glow and its
      // highlights intact. Bright source pixels have less boost headroom.
      extraLight *= 1.0 - 0.45 * lum;
      extraLight /= 1.0 + 0.35 * extraLight;
      shimmer = 0.25;
    }
    vec3 colour = aColor;
    if (uVibrancyPulse > 0.0 && amp > 0.0) {
      float low = min(colour.r, min(colour.g, colour.b));
      float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
      float saturation = (lum - low) / max(lum, 0.0001);
      float lift = 1.0 + uVibrancyPulse * amp * 1.5 * (1.0 - saturation);
      // Expand chroma within the source gamut instead of clipping channels.
      float room = min((1.0 - luma) / max(lum - luma, 0.0001),
                       luma / max(luma - low, 0.0001));
      colour = vec3(luma) + (colour - vec3(luma)) * max(1.0, min(lift, room));
    }
    vec3 lit = colour * (0.78 + extraLight)
             + vec3(0.07, 0.09, 0.13) * extraLight * (1.0 - lum) * 0.7 * shimmer;
    // normalize for point size: bigger points overlap more, so dim per point
    lit *= uSizeComp;
    // points nearer the camera cover more screen: dim them the same way
    lit /= sqrt(max(uCamZ / -mv.z, 0.5));
    if (uHueEnabled > 0.5 && amp > 0.0) {
      float c = bandSample.g * 2.0 - 1.0;
      float h = bandSample.b * 2.0 - 1.0;
      vColor = max(vec3(
        dot(vec3(0.213 + 0.787*c - 0.213*h, 0.715 - 0.715*c - 0.715*h, 0.072 - 0.072*c + 0.928*h), lit),
        dot(vec3(0.213 - 0.213*c + 0.143*h, 0.715 + 0.285*c + 0.140*h, 0.072 - 0.072*c - 0.283*h), lit),
        dot(vec3(0.213 - 0.213*c - 0.787*h, 0.715 - 0.715*c + 0.715*h, 0.072 + 0.928*c + 0.072*h), lit)
      ), vec3(0.0));
    } else {
      vColor = lit;
    }
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
    gl_FragColor = vec4(vColor * uGlow * uVis * a, a); // original additive glow
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
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
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
    this.hueReaction = 0;
    this.hueLookup = buildHueLookup(0);
    this.hueTracker = new HueAccentTracker(this.bandCount);
    this.hueCycle = 0;
    this.hueCycleTracker = new HueCycleTracker(this.bandCount);
    this.bandTex = new THREE.DataTexture(this.bandData, this.bandCount, 1, THREE.RGBAFormat);
    this.bandTex.magFilter = THREE.NearestFilter;
    this.bandTex.minFilter = THREE.NearestFilter;
    this.bandTex.needsUpdate = true;

    this.uniforms = {
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uIntensity: { value: 1 },
      uDepthScale: { value: 0.35 },
      uAspect: { value: 1 },
      uSize: { value: 2 },
      uCamZ: { value: 1.4 },
      uLayers: { value: new THREE.Vector4() },
      uExtraLayers: { value: new THREE.Vector4() },
      uBandMap: { value: 1 },
      uBandCount: { value: 64 },
      uInvert: { value: 0 },
      uLightPulse: { value: 1 },
      uLightFollowMotion: { value: 0 },
      uSizePulse: { value: 1 },
      uVibrancyPulse: { value: 0 },
      uHueEnabled: { value: 0 },
      uSizeComp: { value: 1 },
      uZMove: { value: 1 },
      uXYMove: { value: 1 },
      uVis: { value: 1 },
      uXYTime: { value: 0 },
      uWaveTime: { value: 0 },
      uCentered: { value: 0 },
      uEqualDepthMovement: { value: 0 },
      uDyn: { value: 1 },
      uExitPush: { value: 0 },
      uCursor: { value: new THREE.Vector3(0, 0, 0) },
      uGlow: { value: 1.1 },
      uPreserveBoostColor: { value: 1 },
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
    this.backdropSource = null;
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
    this._ensureBackdropResolution();
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
    // so scaling its footprint by (camBaseZ + 0.02) / camBaseZ
    // projects it onto the same screen rect as the unshifted particles.
    const k = (this.camBaseZ + 0.02) / this.camBaseZ;
    this.backdrop.scale.set(this.cloudAspect * k, k, 1);
  }

  _backdropSize() {
    return backdropTextureSize(
      this.backdropSource.width, this.backdropSource.height,
      Math.ceil(window.innerWidth * this.basePixelRatio),
      Math.ceil(window.innerHeight * this.basePixelRatio),
      this.overscan || 1,
      this.renderer.capabilities.maxTextureSize,
    );
  }

  _createBackdropTexture() {
    const { width, height } = this._backdropSize();
    let source = this.backdropSource;
    // ImageBitmap uploads ignore Texture.flipY, so draw it to a canvas once.
    // Resize from the original bitmap directly to avoid a second resample.
    const bitmap = typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap;
    if (bitmap || source.width !== width || source.height !== height) {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      c.getContext('2d').drawImage(source, 0, 0, width, height);
      source = c;
    }
    const tex = new THREE.CanvasTexture(source);
    // ShaderMaterials write display-space values directly to the framebuffer.
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  _ensureBackdropResolution() {
    if (!this.backdrop || !this.backdropSource) return;
    const { width, height } = this._backdropSize();
    const slot = this.backdrop.material.uniforms.uTex;
    if (slot.value.image.width >= width && slot.value.image.height >= height) return;
    const old = slot.value;
    slot.value = this._createBackdropTexture();
    old.dispose();
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
      this.backdrop.material.uniforms.uTex.value.dispose();
      this.backdrop.material.dispose();
      this.backdrop.geometry.dispose();
      this.backdrop = null;
    }
    this.backdropSource = null;
    if (mode === 'off' || !bitmapOrCanvas) {
      this.renderer.setClearColor(0x000000, 1);
      return;
    }
    this.backdropSource = bitmapOrCanvas;
    const tex = this._createBackdropTexture();
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: tex }, uDim: { value: mode === 'dim' ? 0.17 : 0 }, uAspect: { value: 1 },
      },
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
    this.hueTracker = new HueAccentTracker(n);
    this.hueCycleTracker = new HueCycleTracker(n);
    this.bandTex.dispose();
    this.bandTex = new THREE.DataTexture(this.bandData, n, 1, THREE.RGBAFormat);
    this.bandTex.magFilter = THREE.NearestFilter;
    this.bandTex.minFilter = THREE.NearestFilter;
    this.bandTex.needsUpdate = true;
    this.uniforms.uBands.value = this.bandTex;
    this.uniforms.uBandCount.value = n;
  }

  applySettings(s) {
    const hueReaction = Math.max(-180, Math.min(180, s.hueReaction || 0));
    if (hueReaction !== this.hueReaction) {
      if (this.hueReaction === 0) this.hueTracker.pendingReset = true;
      this.hueReaction = hueReaction;
      this.hueLookup = buildHueLookup(hueReaction);
    }
    this.hueFocus = s.hueFocus;
    const hueCycle = Math.max(0, Math.min(180, s.hueCycle || 0));
    if (hueCycle > 0 && this.hueCycle === 0) {
      this.hueCycleTracker = new HueCycleTracker(this.bandCount);
      this.hueAngleLookup ||= buildHueAngleLookup();
    }
    this.hueCycle = hueCycle;
    this.uniforms.uHueEnabled.value = hueReaction !== 0 || hueCycle > 0 ? 1 : 0;
    this.uniforms.uIntensity.value = s.intensity;
    this.uniforms.uDepthScale.value = s.depthScale;
    this.uniforms.uLayers.value.set(s.motionWave, s.motionRipple, s.motionBands, s.motionDrift);
    this.uniforms.uExtraLayers.value.set(s.motionSwirl, s.motionBreathe, s.motionSweep, s.motionBandShake);
    this.uniforms.uBandMap.value = BAND_MAPS[s.bandMap] ?? 0;
    this.uniforms.uInvert.value = s.invertBands ? 1 : 0;
    this.uniforms.uGlow.value = s.glow;
    this.uniforms.uLightPulse.value = s.boost;
    this.uniforms.uLightFollowMotion.value = s.lightFollowMotion ? 1 : 0;
    this.uniforms.uSizePulse.value = s.sizePulse;
    this.uniforms.uVibrancyPulse.value = s.vibrancyPulse;
    const preserveBoostColor = !!s.preserveBoostColor;
    this.uniforms.uPreserveBoostColor.value = preserveBoostColor ? 1 : 0;
    this.uniforms.uZMove.value = s.depthMove;
    this.uniforms.uXYMove.value = s.xyMove;
    this.overscan = s.overscan;
    this.hideBackdrop = !!s.hideBackdrop;
    this.cursorRipple = !!s.cursorRipple;
    this.uniforms.uExitPush.value = s.flybyExit ? 0.4 : 0;
    this.speedVol = s.speedVol;
    this.motionSpeed = s.motionSpeed;
    this.musicParallax = s.musicParallax || 0;
    this.quietMovement = s.quietMovement;
    this.energyResponse = s.energyResponse;
    this.uniforms.uCentered.value = s.centeredMotion ? 1 : 0;
    this.uniforms.uEqualDepthMovement.value = s.equalDepthMovement ? 1 : 0;
    this.setBandCount(s.bands);
    // size compensation: additive brightness ∝ point area (diameter²),
    // normalized so size ≈ 1 (diameter = spacing) is the reference look
    this.uniforms.uSizeComp.value =
      1 / THREE.MathUtils.clamp(s.pointSize * s.pointSize, 0.35, 6);
    this.pointSizeSetting = s.pointSize;
    this.motionMix = Math.min(1, s.motionWave + s.motionRipple + s.motionBands + s.motionDrift
      + s.motionSwirl * 0.28 + s.motionBreathe + s.motionSweep);
    this._fitCamera();
    this._layoutBackdrop();
    this._ensureBackdropResolution();
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.setPixelRatio(this.basePixelRatio * this.quality);
  }

  /** one frame; audio analyzer supplies bands/energy. dt is clamped. */
  render(analyzer, parallaxStrength) {
    const now = performance.now();
    let dt = (now - this.lastNow) / 1000;
    this.lastNow = now;
    dt = Math.min(dt, 0.05);
    this.time += dt;

    const bands = analyzer.bands;
    const count = Math.min(this.bandCount, bands.length);
    const hueLevels = this.hueReaction
      ? this.hueTracker.update(bands, count, dt, this.hueFocus)
      : null;
    const cycleAngles = this.hueCycle
      ? this.hueCycleTracker.update(bands, count, dt, this.hueCycle)
      : null;
    // bass + treble levels for music parallax, folded into the texture loop
    // (lowest vs highest quarter of bands)
    let lowSum = 0, highSum = 0, lowN = 0, highN = 0;
    const q = Math.max(1, count >> 2);
    let textureChanged = false;
    for (let i = 0; i < count; i++) {
      const b = bands[i];
      const v = Math.min(255, b * 255) | 0;
      const offset = i * 4;
      const hueOffset = (hueLevels ? hueLevels[i] : v) * 2;
      const combinedOffset = cycleAngles
        ? (Math.round((hueLevels ? hueLevels[i] / 255 * this.hueReaction : 0) + cycleAngles[i]) + 360) * 2
        : 0;
      const hueCos = cycleAngles ? this.hueAngleLookup[combinedOffset] : this.hueLookup[hueOffset];
      const hueSin = cycleAngles ? this.hueAngleLookup[combinedOffset + 1] : this.hueLookup[hueOffset + 1];
      if (this.bandData[offset] !== v || this.bandData[offset + 1] !== hueCos ||
          this.bandData[offset + 2] !== hueSin || this.bandData[offset + 3] !== 255) {
        this.bandData[offset] = v;
        this.bandData[offset + 1] = hueCos;
        this.bandData[offset + 2] = hueSin;
        this.bandData[offset + 3] = 255;
        textureChanged = true;
      }
      if (i < q) { lowSum += b; lowN++; }
      else if (i >= count - q) { highSum += b; highN++; }
    }
    if (textureChanged) this.bandTex.needsUpdate = true;

    // volume-ramped motion clocks: the louder the music, the faster the
    // shimmer and waves travel (speedVol = 0 keeps them constant). Motion
    // speed is the base tempo multiplier on top.
    const speedVol = this.speedVol ?? 0;
    const mspd = Math.max(0, this.motionSpeed ?? 1);
    this.xyTime = (this.xyTime ?? 0) + dt * mspd * (1 + analyzer.energy * speedVol * 1.5);
    this.waveTime = (this.waveTime ?? 0) + dt * mspd * (1 + analyzer.energy * speedVol);
    this.uniforms.uXYTime.value = this.xyTime;
    this.uniforms.uWaveTime.value = this.waveTime;
    this.uniforms.uEnergy.value = analyzer.energy;

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
    const drift = this.motionMix ?? 0;
    this.pointer.x += (this.pointer.tx - this.pointer.x) * Math.min(1, dt * 3);
    this.pointer.y += (this.pointer.ty - this.pointer.y) * Math.min(1, dt * 3);
    // music parallax: bass-vs-treble tilt drives x, bass level drives y —
    // independent of the pointer. Music is nearly always bass-heavy, so the
    // raw tilt would pin to one side: subtract its own slow average (the
    // offset) so it centers, then scale the deviation to the full -1..1 range
    // against a decaying peak — the camera moves both ways, and moves more.
    const mp = (this.musicParallax || 0) * 0.075;
    // Smooth the fixed-reference loudness; the same curve is shown in the UI.
    const loud = Number.isFinite(analyzer.loud) ? analyzer.loud : 0;
    if (!Number.isFinite(this.loudEma)) this.loudEma = loud;
    this.loudEma += (loud - this.loudEma) * Math.min(1, dt * 0.5);
    const mamp = movementResponse(this.loudEma, this.quietMovement, this.energyResponse);
    this.uniforms.uDyn.value = mamp;
    if (mp > 0) {
      let raw = (lowN && highN) ? (lowSum / lowN - highSum / highN) : 0;
      if (!Number.isFinite(raw)) raw = 0;
      this.tiltBase = this.tiltBase === undefined
        ? raw
        : this.tiltBase + (raw - this.tiltBase) * Math.min(1, dt * 0.1);
      if (!Number.isFinite(this.tiltBase)) this.tiltBase = raw;
      const dev = raw - this.tiltBase;
      this.tiltPeak = Math.max(Math.abs(dev), (this.tiltPeak ?? 0.1) * Math.exp(-dt / 10));
      if (!Number.isFinite(this.tiltPeak)) this.tiltPeak = 0.1;
      const tilt = Math.max(-1, Math.min(1, dev / Math.max(this.tiltPeak, 0.05)));
      let bass = lowN ? lowSum / lowN : 0;
      // y gets the same treatment as x: subtract the bass level's own slow
      // average so it centers, then scale the deviation to the full -1..1
      // range against a decaying peak — bass hits pull the camera down, bass
      // drops lift it up, and quiet tracks still move
      if (!Number.isFinite(bass)) bass = 0;
      this.bassBase = this.bassBase === undefined
        ? bass
        : this.bassBase + (bass - this.bassBase) * Math.min(1, dt * 0.1);
      if (!Number.isFinite(this.bassBase)) this.bassBase = bass;
      const bdev = bass - this.bassBase;
      this.bassDevPeak = Math.max(Math.abs(bdev), (this.bassDevPeak ?? 0.1) * Math.exp(-dt / 10));
      if (!Number.isFinite(this.bassDevPeak)) this.bassDevPeak = 0.1;
      const bassN = Math.max(-1, Math.min(1, bdev / Math.max(this.bassDevPeak, 0.05)));
      this.musicPx = (this.musicPx ?? 0) + (tilt - (this.musicPx ?? 0)) * Math.min(1, dt * 4);
      this.musicPy = (this.musicPy ?? 0) + (bassN - (this.musicPy ?? 0)) * Math.min(1, dt * 4);
      if (!Number.isFinite(this.musicPx)) this.musicPx = 0;
      if (!Number.isFinite(this.musicPy)) this.musicPy = 0;
    } else {
      this.musicPx = 0;
      this.musicPy = 0;
    }
    const t = this.time;
    this.camera.position.x = Math.sin(t * 0.13) * p * 0.6 * drift + this.pointer.x * p + (this.musicPx ?? 0) * mp * mamp;
    this.camera.position.y = Math.cos(t * 0.11) * p * 0.4 * drift - this.pointer.y * p * 0.6 - (this.musicPy ?? 0) * mp * 1.4 * mamp;

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
    this.camera.position.z = this.camBaseZ;
    this.camera.lookAt(0, 0, 0.1);

    this.renderer.render(this.scene, this.camera);
    return dt;
  }
}
