// Three.js scene: the image as a depth-layered point cloud, displaced by
// audio-driven waves in the vertex shader. One draw call for the cloud,
// one for the backdrop. Optional framing tracks a cached set of border points.

import * as THREE from '../vendor/three.module.js';
import { movementResponse } from './response.js';
import { bandResponse } from './bands.js';
import { buildHueLookup, buildHueAngleLookup, HueAccentTracker, HueCycleTracker } from './hue.js';
import { backdropTextureSize } from './backdrop-size.js';
import { DynamicFraming } from './dynamic-framing.js';
import {depthBandLookup,DEPTH_BINS} from './depth-bands.js';
import { MusicParallaxDirection } from './music-parallax.js';
import { SideMask } from './side-mask.js';

const VERT = /* glsl */ `
  uniform float uEnergy;
  uniform float uIntensity;
  uniform float uDepthScale;
  uniform float uDepthShape;
  uniform float uDepthShapeMotion;
  uniform float uCurvature;
  uniform float uDepthShading;
  uniform float uDepthShadingMotion;
  uniform float uAspect;
  uniform float uSize;
  uniform float uCamZ;
  uniform vec4 uLayers; // wave, ripple, bands, drift
  uniform vec4 uExtraLayers; // swirl, breathe, sweep, band shake
  uniform float uBandMap;
  uniform float uBandDistribution;
  uniform float uSmartDepthBands;
  uniform sampler2D uDepthBands;
  uniform sampler2D uSurfaceMotion;
  uniform float uSurfaceCohesion;
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
  #include <packing>
  uniform float uReconstructionOcclusion;
  uniform float uReconstructionSideOcclusion;
  uniform sampler2D uSideMask;
  uniform float uSideMaskEnabled;
  uniform float uFillSpacing;
  uniform float uSideMaskDepthTolerance;
  #ifdef SIDE_MASK
    uniform float uSideMaskWallCoverage;
    uniform float uSideMaskFaceCoverage;
    uniform float uSideMaskFaceSpacing;
    uniform float uSideMaskHeight;
    attribute vec2 aMaskOffset;
  #endif
  #ifdef OCCLUDED_BACKGROUND
    attribute vec4 aOccluder;
    attribute vec2 aOutward;
    attribute vec3 aSideThickness;
    attribute vec4 aSideFront;
    attribute vec4 aSideRear;
    uniform float uReconstructionBrightness;
    uniform float uSideWallReferences;
  #endif
  #ifdef GAP_FILL
    attribute vec4 aFillStart;
    attribute vec4 aFillEnd;
    attribute float aFillT;
    attribute vec3 aFillThickness;
    attribute vec4 aFillForeground;
    uniform float uFillBrightness;
    uniform float uFillSamples;
  #endif
  #if defined(GAP_FILL) || defined(OCCLUDED_BACKGROUND)
    uniform float uFillOnlyOpen;
    uniform float uFillAdaptive;
    uniform float uFillThicknessAuto;
    uniform float uFillThicknessBias;
    uniform float uFillThicknessBalance;
    uniform float uFillThicknessManual;
    uniform float uFillThickness;
  #endif

  varying vec3 vColor;
  varying float vAmp;
  #ifdef SIDE_MASK
    varying float vMaskOpen;
  #endif

  #ifndef SIDE_MASK
  bool wallOccludes(vec4 pointClip) {
    bool covered=false;
    if(uSideMaskEnabled>.5 && uReconstructionOcclusion>.5 && uReconstructionSideOcclusion>.5 && pointClip.w>0.0){
      vec2 uv=pointClip.xy/pointClip.w*.5+.5;
      if(all(greaterThanEqual(uv,vec2(0.0))) && all(lessThanEqual(uv,vec2(1.0)))){
        vec4 packed=texture2D(uSideMask,uv);
        float depth=pointClip.z/pointClip.w*.5+.5;
        // Keep coplanar wall points despite depth interpolation/rounding.
        float bias=max(.000002,uSideMaskDepthTolerance*uFillSpacing*abs(projectionMatrix[3][2])/(2.0*pointClip.w*pointClip.w));
        covered=any(greaterThan(packed,vec4(0.0))) && depth>unpackRGBAToDepth(packed)+bias;
      }
    }
    return covered;
  }
  #endif

  float shapedDepth(float near) {
    return near + uDepthShape * near * (near - 1.0);
  }
  float shapedMotionDepth(float z) {
    float reference = uDepthScale > 0.0 ? uDepthScale : 0.33;
    float t = z / reference;
    float bounded = clamp(t, 0.0, 1.0);
    // Extend monotonically beyond the reference range; negative centered
    // motion must never reverse direction or be clamped to a flat plane.
    float slope = t < 0.0 ? max(0.05, 1.0-uDepthShape) : 1.0+uDepthShape;
    return (shapedDepth(bounded) + (t-bounded)*slope)*reference;
  }
  float curvatureDepth(vec2 point) {
    vec2 uv = point / vec2(uAspect, 1.0);
    return uCurvature * dot(uv, uv);
  }

  void evaluatePoint(vec3 pointPosition, float pointRand, vec3 pointColor, out vec3 pos, out vec3 colourOut, out float ampOut, out float pointSize) {
    float near = pointPosition.z;                 // 0..1, 1 = closest to viewer
    vec2 uvw = vec2(pointPosition.x / uAspect + 0.5, pointPosition.y + 0.5);

    // which region of the image listens to which frequency band:
    // 0 = by depth layer, 1 = radial from center, 2 = bottom->top, 3 = left->right
    float bt;
    if (uBandMap < 0.5) {
      bt = near;
      if (uBandDistribution != 1.0 && uSmartDepthBands<.5) bt = pow(clamp(near, 0.0, 1.0), uBandDistribution);
    } else if (uBandMap < 1.5) {
      bt = clamp(distance(uvw, vec2(0.5)) * 1.25, 0.0, 1.0);   // center = bass, edges = highs
    } else if (uBandMap < 2.5) {
      bt = 1.0 - uvw.y;                                         // ground = bass, sky = highs
    } else {
      bt = uvw.x;                                               // left = bass, right = highs
    }
    if (uInvert > 0.5) bt = 1.0 - bt;   // swap bass <-> highs direction
    float band = clamp(floor(bt * uBandCount), 0.0, uBandCount - 1.0);
    if(uBandMap<.5 && uSmartDepthBands>.5){
      band=floor(texture2D(uDepthBands,vec2(clamp(near,0.0,1.0),.5)).r*255.0+.5);
      if(uInvert>.5)band=uBandCount-1.0-band;
    }
    // already shaped by the analyzer (gain -> floor -> curve)
    vec4 bandSample = texture2D(uBands, vec2((band + 0.5) / uBandCount, 0.5));
    float amp = bandSample.r;
    float lightAmp = amp;                     // no global dimming: quiet
                                              // regions keep their base light

    float originalAmp=amp, surfaceWeight=0.0, motionNear=near, anchorBand=band;
    if(uSurfaceCohesion>0.0 && uBandMap<.5){
      vec4 surface=texture2D(uSurfaceMotion,vec2(uvw.x,1.0-uvw.y));
      // The background reconstructed behind this pixel is a different surface.
      surfaceWeight=surface.g*uSurfaceCohesion*step(abs(near-surface.b),.025);
      motionNear=mix(near,surface.r,surfaceWeight);
      float anchorT=pow(clamp(surface.r,0.0,1.0),uBandDistribution);
      if(uInvert>.5)anchorT=1.0-anchorT;
      anchorBand=clamp(floor(anchorT*uBandCount),0.0,uBandCount-1.0);
      if(uSmartDepthBands>.5){
        anchorBand=floor(texture2D(uDepthBands,vec2(clamp(surface.r,0.0,1.0),.5)).r*255.0+.5);
        if(uInvert>.5)anchorBand=uBandCount-1.0-anchorBand;
      }
      amp=mix(amp,texture2D(uBands,vec2((anchorBand+.5)/uBandCount,.5)).r,surfaceWeight);
    }
    float direct = mix(1.0, amp * 2.0 - 0.8, uCentered);
    float w = direct;
    // Uniform branches skip every disabled layer. Normalize the combined
    // depth overlay so stacking styles leaves the direct response intact.
    float style = 0.0;
    float layerTotal = dot(uLayers, vec4(1.0)) + uExtraLayers.z;
    if (uLayers.x > 0.0) {
      // traveling wave across the image
      style += uLayers.x * sin(uWaveTime * 1.7 + uvw.x * 7.0 + motionNear * 5.0 + pointRand * 0.7);
    }
    if (uLayers.y > 0.0) {
      // radial ripple from the center
      float d = distance(uvw, vec2(0.5));
      style += uLayers.y * sin(d * 16.0 - uWaveTime * 3.1 + motionNear * 3.0) * (1.0 - d * 0.55);
    }
    if (uLayers.z > 0.0) {
      // horizontal slices pulsing like bars
      float row = floor(uvw.y * 28.0);
      style += uLayers.z * (sin(uWaveTime * 2.2 + row * 0.9) * 0.75 + sin(uWaveTime * 5.3 + row * 2.1) * 0.25);
    }
    if (uLayers.w > 0.0) {
      // slow ambient drift (nice at idle / low energy)
      float drift = sin(uvw.x * 9.0 + uWaveTime * 0.5) * sin(uvw.y * 7.0 - uWaveTime * 0.42) * 1.3
        + sin(uWaveTime * 0.8 + pointRand * 6.2831) * 0.45;
      style += uLayers.w * clamp(drift, -1.0, 1.0);
    }
    if (uExtraLayers.z > 0.0) {
      style += uExtraLayers.z * sin((uvw.x + uvw.y) * 11.0 - uWaveTime * 2.0 + motionNear * 2.0);
    }
    w = direct + style / max(1.0, layerTotal) * 0.65;

    float depthRange = mix(0.35 + 0.65 * motionNear, 1.0, uEqualDepthMovement);
    float disp = w * amp * uIntensity * uZMove * 0.11 * depthRange * uDyn;

    pos = vec3(pointPosition.xy, shapedDepth(near) * uDepthScale + disp);
    if(uDepthShapeMotion>0.5) pos.z = shapedMotionDepth(near*uDepthScale+disp);
    pos.xy += vec2(sin(uXYTime * 3.1 + pointRand * 40.0), cos(uXYTime * 2.6 + pointRand * 30.0))
            * amp * 0.006 * uIntensity * uXYMove * uDyn;
    // Explicit layers have their own amounts; XY move controls the original
    // shimmer only. Apply a true rotation and scale so their shapes remain
    // clear and adding Breathe cannot dilute Swirl (or vice versa).
    vec2 layeredXY = pointPosition.xy;
    float layerDrive = amp * min(uIntensity * uDyn, 1.5);
    float lightStyle = style;
    float lightTotal = layerTotal;
    if (uExtraLayers.x > 0.0) {
      float swirlPhase = sin(uWaveTime * 0.8 + length(pointPosition.xy) * 4.0 + motionNear * 1.2);
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
      float breathePhase = sin(uWaveTime * 1.4 + motionNear * 1.2);
      float swell = breathePhase * uExtraLayers.y * layerDrive * 0.2;
      layeredXY *= 1.0 + swell;
      if (uLightFollowMotion > 0.5) {
        lightStyle += breathePhase * uExtraLayers.y;
        lightTotal += uExtraLayers.y;
      }
    }
    pos.xy += layeredXY - pointPosition.xy;
    if (uLightFollowMotion > 0.5 && uLightPulse > 0.0 && lightTotal > 0.0) {
      // Shape only the extra light, never the resting image/glow. Keep the
      // original band's peak brightness. Amounts mix the patterns, while
      // contrast remains clear even when geometric motion is subtle.
      float pattern = 0.5 + 0.5 * clamp(lightStyle / lightTotal, -1.0, 1.0);
      lightAmp *= pattern;
    }
    if (uExtraLayers.w > 0.0) {
      // Every point mapped to this band receives exactly the same vector.
      // Smooth, distinct phases give bands their own motion without flicker.
      float phase = band * 2.399963;
      vec2 shake = vec2(sin(uXYTime * 4.3 + phase),
                        sin(uXYTime * 5.7 + phase * 1.37 + 1.1));
      if(surfaceWeight>0.0){
        float anchorPhase=anchorBand*2.399963;
        shake=mix(shake,vec2(sin(uXYTime*4.3+anchorPhase),sin(uXYTime*5.7+anchorPhase*1.37+1.1)),surfaceWeight);
      }
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
    pos.z += curvatureDepth(pointPosition.xy);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);


    amp=originalAmp; // frequency colour and point growth remain band independent
    float ps = uSize * (1.0 + amp * 0.9 * uSizePulse) * (uCamZ / -mv.z);
    pointSize = clamp(ps, 0.75, 24.0);

    ampOut = amp;
    // every particle stays visible at base brightness; the loud/moving ones
    // brighten on top, and dark particles catch a cool shimmer
    float lum = max(pointColor.r, max(pointColor.g, pointColor.b));
    float extraLight = uLightPulse * lightAmp;
    float shimmer = 1.0;
    if (uPreserveBoostColor > 0.5) {
      // Soften only the extra audio light, leaving the base glow and its
      // highlights intact. Bright source pixels have less boost headroom.
      extraLight *= 1.0 - 0.45 * lum;
      extraLight /= 1.0 + 0.35 * extraLight;
      shimmer = 0.25;
    }
    vec3 colour = pointColor;
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
    if(uDepthShading>0.0) {
      // A stable depth reference avoids brightness pumping from frame-wise
      // min/max normalisation. Motion-only scenes still have a usable range.
      float shadeNear = near;
      if(uDepthShadingMotion>0.5) shadeNear = clamp(pos.z / max(uDepthScale, 0.33), 0.0, 1.0);
      lit *= 1.0-uDepthShading*.45*(1.0-shadeNear);
    }
    if (uHueEnabled > 0.5 && amp > 0.0) {
      float c = bandSample.g * 2.0 - 1.0;
      float h = bandSample.b * 2.0 - 1.0;
      colourOut = max(vec3(
        dot(vec3(0.213 + 0.787*c - 0.213*h, 0.715 - 0.715*c - 0.715*h, 0.072 - 0.072*c + 0.928*h), lit),
        dot(vec3(0.213 - 0.213*c + 0.143*h, 0.715 + 0.285*c + 0.140*h, 0.072 - 0.072*c - 0.283*h), lit),
        dot(vec3(0.213 - 0.213*c - 0.787*h, 0.715 - 0.715*c + 0.715*h, 0.072 + 0.928*c + 0.072*h), lit)
      ), vec3(0.0));
    } else {
      colourOut = lit;
    }
  }
  #if defined(GAP_FILL) || defined(OCCLUDED_BACKGROUND)
  float limitedFillSpan(float span, vec3 thickness) {
    float fraction=1.0;
    // Size balance: 1 keeps each object's estimate, 0 gives every object the
    // image's typical depth, above 1 exaggerates small/large differences.
    float size=thickness.z>0.0 ? thickness.z:1.0;
    if(uFillThicknessAuto>.5)fraction=min(1.0,thickness.x*uFillThicknessBias*pow(size,uFillThicknessBalance-1.0));
    if(uFillThicknessManual>.5)fraction=min(fraction,uFillThickness);
    return mix(1.0,fraction,clamp(thickness.y,0.0,1.0));
  }
  #endif
  void main() {
    #ifdef OCCLUDED_BACKGROUND
      vec3 pos, edge, unusedColour;float amp,size,unusedAmp,unusedSize;
      evaluatePoint(position,aRand,aColor,pos,vColor,amp,size);
      vec4 hiddenClip=projectionMatrix*(modelViewMatrix*vec4(pos,1.0));
      float reveal=1.0;
      if(uReconstructionOcclusion>.5){
        evaluatePoint(aOccluder.xyz,aOccluder.w,aColor,edge,unusedColour,unusedAmp,unusedSize);
        vec4 edgeClip=projectionMatrix*(modelViewMatrix*vec4(edge,1.0));
        vec4 axisClip=projectionMatrix*(modelViewMatrix*vec4(edge+vec3(aOutward*uFillSpacing,0.0),1.0));
        reveal=0.0;
        if(min(min(hiddenClip.w,edgeClip.w),axisClip.w)>0.0){
          vec2 metric=vec2(projectionMatrix[1][1]/projectionMatrix[0][0],1.0);
          vec2 normal=(axisClip.xy/axisClip.w-edgeClip.xy/edgeClip.w)*metric;
          float spacing=max(length(normal),0.000001);
          float uncovered=dot((hiddenClip.xy/hiddenClip.w-edgeClip.xy/edgeClip.w)*metric,normal/spacing);
          float matchedSideReveal=-1.0;
          if(uReconstructionSideOcclusion>.5 && (uSideWallReferences<.5 || aSideRear.w>-1.5)){
            vec3 rear, unusedRearColour;float unusedRearAmp,unusedRearSize;
            // The same foreground boundary at this hidden slice's depth gives
            // the rear direction under camera, audio and spatial-layer motion.
            vec3 wallEdge=edge;
            bool matchedWall=uSideWallReferences>.5 && aSideRear.w>=0.0;
            vec3 restXY=vec3(0.0);
            vec2 wallOffset=vec2(0.0);
            if(matchedWall){
              // Evaluate at this cell's position along the contour, rather
              // than projecting a jittered row at a different height. Retain
              // its normal offset, depth pair and random phases.
              vec2 tangent=vec2(-aOutward.y,aOutward.x);
              wallOffset=tangent*dot(aOccluder.xy-aSideFront.xy,tangent);
              evaluatePoint(vec3(aSideFront.xy+wallOffset,aSideFront.z),aSideFront.w,aColor,wallEdge,unusedRearColour,unusedRearAmp,unusedRearSize);
              evaluatePoint(vec3(aSideRear.xy+wallOffset,aSideRear.z),aSideRear.w,aColor,rear,unusedRearColour,unusedRearAmp,unusedRearSize);
              restXY=vec3(aSideRear.xy-aSideFront.xy,0.0);
            }else{
              evaluatePoint(vec3(aOccluder.xy,position.z),aRand,aColor,rear,unusedRearColour,unusedRearAmp,unusedRearSize);
            }
            vec3 separation=rear-wallEdge-restXY;
            float sideVisibility=1.0;
            if(uFillOnlyOpen>.5 || uFillAdaptive>0.0){
              vec3 restDelta=vec3(0.0,0.0,(shapedDepth(position.z)-shapedDepth(aOccluder.z))*uDepthScale);
              if(matchedWall)restDelta=vec3(restXY.xy,
                (shapedDepth(aSideRear.z)-shapedDepth(aSideFront.z))*uDepthScale
                +curvatureDepth(aSideRear.xy+wallOffset)-curvatureDepth(aSideFront.xy+wallOffset));
              vec3 centre=(wallEdge+rear)*.5;
              vec4 wallFrontClip=projectionMatrix*(modelViewMatrix*vec4(wallEdge,1.0));
              vec4 fullRearClip=projectionMatrix*(modelViewMatrix*vec4(rear,1.0));
              vec4 restFront=projectionMatrix*(modelViewMatrix*vec4(centre-restDelta*.5,1.0));
              vec4 restRear=projectionMatrix*(modelViewMatrix*vec4(centre+restDelta*.5,1.0));
              if(min(min(fullRearClip.w,restFront.w),min(restRear.w,wallFrontClip.w))<=0.0)sideVisibility=0.0;
              else{
                float currentGap=length((fullRearClip.xy/fullRearClip.w-wallFrontClip.xy/wallFrontClip.w)*metric);
                float restingGap=length((restRear.xy/restRear.w-restFront.xy/restFront.w)*metric);
                float centreW=(restFront.w+restRear.w)*.5;
                float referenceGap=max(restingGap,projectionMatrix[1][1]*uFillSpacing/centreW);
                float extraSpacing=max(0.0,(currentGap-restingGap)/max(referenceGap,.000001));
                if(uFillOnlyOpen>.5)sideVisibility=smoothstep(.15,.85,extraSpacing);
                sideVisibility*=mix(1.0,smoothstep(.5,2.5,extraSpacing),uFillAdaptive);
              }
            }
            float fraction=limitedFillSpan(length(separation),aSideThickness);
            vec4 rearClip=projectionMatrix*(modelViewMatrix*vec4(wallEdge+restXY+separation*fraction,1.0));
            if(rearClip.w>0.0){
              // A wall pointing inward must never uncover the original front.
              float sideExtent=max(0.0,dot((rearClip.xy/rearClip.w-edgeClip.xy/edgeClip.w)*metric,normal/spacing));
              if(matchedWall && fraction>0.0){
                // The old depth-map silhouette may be slightly in front of
                // the actual emitted face. Use the real wall's local front
                // and end for its whole mask, rather than multiplying by that
                // older silhouette (which over-cuts short walls).
                vec4 frontClip=projectionMatrix*(modelViewMatrix*vec4(wallEdge,1.0));
                vec4 wallAxis=projectionMatrix*(modelViewMatrix*vec4(wallEdge+vec3(aOutward*uFillSpacing,0.0),1.0));
                if(min(frontClip.w,wallAxis.w)>0.0){
                  vec2 wallNormal=(wallAxis.xy/wallAxis.w-frontClip.xy/frontClip.w)*metric;
                  float wallSpacing=max(length(wallNormal),.000001);
                  float wallExtent=dot((rearClip.xy/rearClip.w-frontClip.xy/frontClip.w)*metric,wallNormal/wallSpacing);
                  float wallUncovered=dot((hiddenClip.xy/hiddenClip.w-frontClip.xy/frontClip.w)*metric,wallNormal/wallSpacing);
                  if(wallExtent>0.0)matchedSideReveal=mix(smoothstep(spacing*.35,spacing*1.35,uncovered),smoothstep(-wallSpacing*.5,wallSpacing*.5,wallUncovered-wallExtent),sideVisibility);
                }
              }else if(!matchedWall)uncovered-=sideExtent*sideVisibility;
            }
          }
          // Behind the object remains invisible. Feather the exposed boundary
          // by one original point spacing to avoid an additive bright outline.
          reveal=matchedSideReveal>=0.0 ? matchedSideReveal:smoothstep(spacing*.35,spacing*1.35,uncovered);
        }
        // Another wall/slice can cover this point even when its own edge
        // reference says it is exposed. Test all emitted walls in screen space.
        if(reveal>0.0 && wallOccludes(hiddenClip))reveal=0.0;
      }
      gl_Position=hiddenClip;gl_PointSize=size;vAmp=amp;
      vColor*=reveal*uReconstructionBrightness;
      if(reveal==0.0){gl_Position=vec4(2.0,2.0,2.0,1.0);gl_PointSize=0.0;}
    #elif defined(GAP_FILL)
      vec3 first, last, firstColour, lastColour;
      float firstAmp, lastAmp, firstSize, lastSize;
      // Magnitude 2 marks a cleaned silhouette: its side always belongs to
      // the foreground, even when the user disables thickness limiting.
      bool sidewall=(abs(aFillForeground.w)>1.5 || uFillThicknessAuto>.5 || uFillThicknessManual>.5) && aFillThickness.y>0.0;
      float sidewallWeight=sidewall ? clamp(aFillThickness.y,0.0,1.0):0.0;
      bool foregroundFirst=aFillStart.z>=aFillEnd.z;
      if(aFillForeground.w!=0.0)foregroundFirst=aFillForeground.w>0.0;
      vec3 fillColour=sidewall && aFillForeground.w!=0.0 ? mix(aColor,aFillForeground.rgb,sidewallWeight):aColor;
      evaluatePoint(aFillStart.xyz, aFillStart.w, fillColour, first, firstColour, firstAmp, firstSize);
      evaluatePoint(aFillEnd.xyz, aFillEnd.w, fillColour, last, lastColour, lastAmp, lastSize);
      vec3 pos = mix(first, last, aFillT);
      float fillSpan=1.0;
      if(sidewall){
        vec3 separation=last-first;
        separation.xy-=aFillEnd.xy-aFillStart.xy;
        float span=length(separation);
        // Shorten the occupied section, rather than discarding samples from
        // the old full bridge. Sparse rows must still cover the shorter wall.
        // Blend the estimate continuously as the edge field approaches the
        // interior, avoiding the old all-or-nothing .01 membership cutoff.
        fillSpan=limitedFillSpan(span,aFillThickness);
        float wallT=foregroundFirst ? aFillT*fillSpan:1.0-(1.0-aFillT)*fillSpan;
        // Preserve resting XY spacing; compress only depth and extra motion.
        pos+=(wallT-aFillT)*separation;
      }
      float opening = 1.0;
      float fillLight = 1.0;
      if (uFillOnlyOpen > 0.5 || uFillAdaptive > 0.0) {
        // Measure extra screen separation, with the resting pair translated
        // to the animated midpoint. Shared movement/camera zoom therefore
        // cannot turn a closed seam into a bright contour.
        vec3 restDelta = vec3(aFillEnd.xy - aFillStart.xy,
                             (shapedDepth(aFillEnd.z) - shapedDepth(aFillStart.z)) * uDepthScale
                             + curvatureDepth(aFillEnd.xy) - curvatureDepth(aFillStart.xy));
        vec3 centre = (first + last) * 0.5;
        vec4 firstClip = projectionMatrix * (modelViewMatrix * vec4(first, 1.0));
        vec4 lastClip = projectionMatrix * (modelViewMatrix * vec4(last, 1.0));
        vec4 restFirst = projectionMatrix * (modelViewMatrix * vec4(centre - restDelta * 0.5, 1.0));
        vec4 restLast = projectionMatrix * (modelViewMatrix * vec4(centre + restDelta * 0.5, 1.0));
        if (min(min(firstClip.w,lastClip.w),min(restFirst.w,restLast.w)) <= 0.0) {
          opening = 0.0;
        } else {
          vec2 metric = vec2(projectionMatrix[1][1] / projectionMatrix[0][0], 1.0);
          float currentGap = length((lastClip.xy / lastClip.w - firstClip.xy / firstClip.w) * metric);
          float restingGap = length((restLast.xy / restLast.w - restFirst.xy / restFirst.w) * metric);
          // Jitter can put endpoints almost on top of each other. Use at
          // least one original grid spacing so tiny gaps cannot saturate.
          float centreW = (restFirst.w + restLast.w) * 0.5;
          float referenceGap = max(restingGap, projectionMatrix[1][1] * uFillSpacing / centreW);
          float extraSpacing = max(0.0, (currentGap - restingGap) / max(referenceGap, 0.000001));
          // Density/brightness follow the shorter occupied section, so
          // redistributing a full pool cannot turn thin walls into hotspots.
          float occupiedSpacing=extraSpacing*fillSpan;
          if (uFillOnlyOpen > 0.5) opening = smoothstep(0.15, 0.85, extraSpacing);
          if (uFillAdaptive > 0.0) {
            #ifdef SIDE_MASK
              // Density controls do not make a solid side transparent.
              // Respect fully closed/inactive rows, then mask its surface.
              if(uFillAdaptive>=.999)opening*=smoothstep(.5,2.5,extraSpacing);
            #else
            // The pool is built once. Reveal a progressive, distributed subset
            // with one-point fades rather than drawing a full row in tiny gaps.
            // One initial coverage point, then a tunable ramp. Reserve the
            // full pool for wide openings even with a low maximum count.
            float coverage = smoothstep(0.15, 0.85, extraSpacing);
            float visibleSamples = min(uFillSamples, coverage + occupiedSpacing * 0.5);
            float rank = aRand * uFillSamples;
            // Strength blends the entire adaptive effect, including a wider
            // onset for narrow seams, rather than just changing point density.
            float narrowGate = smoothstep(0.5, 2.5, extraSpacing);
            float matched = smoothstep(rank, rank + 1.0, visibleSamples) * narrowGate;
            opening *= mix(1.0, matched, uFillAdaptive);
            // Share the light over the available space rather than adding
            // full brightness from several points to a narrow seam.
            fillLight = mix(1.0, min(1.0, occupiedSpacing / max(visibleSamples, 1.0)), uFillAdaptive);
            #endif
          }
        }
      }
      if(uFillThicknessManual>.5 && uFillThickness<=0.0)opening*=1.0-sidewallWeight;
      #ifdef SIDE_MASK
        vMaskOpen=sidewall && fillSpan>0.0 && opening>0.0 ? 1.0:0.0;
      #endif
      gl_Position = projectionMatrix * (modelViewMatrix * vec4(pos, 1.0));
      #ifdef SIDE_MASK
        // Expand across neighbouring wall rows only, never past the rear cap.
        gl_Position.xy+=vec2(projectionMatrix[0][0],projectionMatrix[1][1])
          *(modelViewMatrix*vec4(aMaskOffset*(uSideMaskWallCoverage-1.0),0.0,0.0)).xy;
      #endif
      gl_PointSize = mix(firstSize, lastSize, aFillT);
      vColor = mix(firstColour, lastColour, aFillT) * uFillBrightness * opening * fillLight;
      vAmp = mix(firstAmp, lastAmp, aFillT);
      if(sidewall && aFillForeground.w!=0.0){
        vColor=mix(mix(firstColour,lastColour,aFillT),foregroundFirst ? firstColour:lastColour,sidewallWeight)*uFillBrightness*opening*fillLight;
        vAmp=mix(vAmp,foregroundFirst ? firstAmp:lastAmp,sidewallWeight);
        gl_PointSize=mix(gl_PointSize,foregroundFirst ? firstSize:lastSize,sidewallWeight);
      }
      #ifndef SIDE_MASK
        // The foreground shell supplies the opaque wall. Mask only ordinary
        // background seam fill, never remove the wall filling itself.
        if(!sidewall && wallOccludes(gl_Position))opening=0.0;
      #endif
      if (opening == 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
      }
    #else
      vec3 pos; float amp, size;
      evaluatePoint(position, aRand, aColor, pos, vColor, amp, size);
      gl_Position = projectionMatrix * (modelViewMatrix * vec4(pos, 1.0));
      gl_PointSize = size; vAmp = amp;
      // Ordinary far-layer particles can also show through an additive wall,
      // even when the reconstructed layer is completely hidden.
      #ifdef SIDE_MASK
        vMaskOpen=uSideMaskFaceCoverage>0.0 ? 1.0:0.0;
        // Coverage follows the sampled surface, independent of particle size/light.
        gl_PointSize=clamp(uSideMaskFaceSpacing*uSideMaskFaceCoverage*projectionMatrix[1][1]
          *uSideMaskHeight/max(gl_Position.w,.000001),1.0,64.0);
      #else
        if(wallOccludes(gl_Position)){gl_Position=vec4(2.0,2.0,2.0,1.0);gl_PointSize=0.0;}
      #endif
    #endif
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
      depth: false, // all materials disable depth testing and depth writes
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.autoClearDepth = false;
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.quality = 1; // adaptive multiplier on pixel ratio

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 40);
    this.baseFov = 50;
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

    this.depthBandData=new Uint8Array(DEPTH_BINS*4);
    this.depthBandTex=new THREE.DataTexture(this.depthBandData,DEPTH_BINS,1,THREE.RGBAFormat);
    this.depthBandTex.magFilter=THREE.NearestFilter;this.depthBandTex.minFilter=THREE.NearestFilter;
    this.depthBandTex.needsUpdate=true;
    this.surfaceTex=new THREE.DataTexture(new Float32Array(4),1,1,THREE.RGBAFormat,THREE.FloatType);
    this.surfaceTex.magFilter=THREE.NearestFilter;this.surfaceTex.minFilter=THREE.NearestFilter;this.surfaceTex.needsUpdate=true;
    this.uniforms = {
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uIntensity: { value: 1 },
      uDepthScale: { value: 0.35 },
      uDepthShape: { value: 0 },
      uDepthShapeMotion: { value: 0 },
      uCurvature: { value: 0 },
      uAspect: { value: 1 },
      uSize: { value: 2 },
      uCamZ: { value: 1.4 },
      uLayers: { value: new THREE.Vector4() },
      uExtraLayers: { value: new THREE.Vector4() },
      uBandMap: { value: 1 },
      uDepthShading: { value: 0 },
      uDepthShadingMotion: { value: 0 },
      uFillBrightness: { value: .35 },
      uReconstructionBrightness: { value: .7 },
      uReconstructionOcclusion: { value: 1 },
      uReconstructionSideOcclusion: { value: 0 },
      uSideWallReferences: { value: 0 },
      uSideMaskDepthTolerance: {value:1},
      uSideMaskWallCoverage: {value:1},
      uSideMaskFaceCoverage: {value:0},
      uSideMaskFaceSpacing: {value:0},
      uSideMaskHeight: {value:1},
      uFillOnlyOpen: { value: 1 },
      uFillAdaptive: { value: 1 },
      uFillSamples: { value: 12 },
      uFillSpacing: { value: 1 / 300 },
      uFillThicknessAuto: { value: 0 },
      uFillThicknessBias: { value: 1 },
      uFillThicknessBalance: { value: 1 },
      uFillThicknessManual: { value: 0 },
      uFillThickness: { value: .6 },
      uSmartDepthBands: {value:0},
      uDepthBands: {value:this.depthBandTex},
      uSurfaceMotion: {value:this.surfaceTex},
      uSurfaceCohesion: {value:0},
      uBandDistribution: { value: 1 },
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

    this.sideMask = new SideMask(VERT,this.uniforms);
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
    // Base wallpaper cover fit. Dynamic framing tracks uneven animated edges.
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2));
    const dH = 0.5 / halfH;                                       // height just fills
    const dW = (this.cloudAspect / 2) / (halfH * this.camera.aspect); // width just fills
    this.camBaseZ = Math.min(dH, dW);
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
    this.sideMask.setGeometry(cloud.sideMask);
    this.sideMask.setFaces(cloud);
    this.depthHistogram=cloud.depthHistogram;
    this.surfaceMotion=cloud.surfaceMotion||null;
    this.surfaceTex.dispose();
    this.surfaceTex=new THREE.DataTexture(this.surfaceMotion?.data||new Float32Array(4),this.surfaceMotion?.w||1,this.surfaceMotion?.h||1,THREE.RGBAFormat,THREE.FloatType);
    this.surfaceTex.magFilter=THREE.NearestFilter;this.surfaceTex.minFilter=THREE.NearestFilter;this.surfaceTex.needsUpdate=true;
    this.uniforms.uSurfaceMotion.value=this.surfaceTex;
    this.depthBandKey=null;
    if(this.reconstructionPoints){this.scene.remove(this.reconstructionPoints);this.reconstructionPoints.geometry.dispose();this.reconstructionPoints=null;}
    if(this.fillPoints){this.scene.remove(this.fillPoints);this.fillPoints.geometry.dispose();this.fillPoints=null;}
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points = null;
    }
    this.cloudAspect = cloud.aspect;
    const baseCount=cloud.baseCount ?? cloud.count;
    this.dynamicFraming = new DynamicFraming({...cloud,count:baseCount});
    this.uniforms.uAspect.value = cloud.aspect;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(cloud.positions.subarray(0,baseCount*3), 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(cloud.colors.subarray(0,baseCount*3), 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(cloud.rands.subarray(0,baseCount), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0.4), Math.max(cloud.aspect, 1));

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    const hidden=cloud.reconstruction;
    this.uniforms.uSideWallReferences.value=hidden?.sideRears ? 1:0;
    if(hidden?.rands.length){
      this.reconstructionMaterial ||= new THREE.ShaderMaterial({uniforms:this.uniforms,defines:{OCCLUDED_BACKGROUND:1},vertexShader:VERT,fragmentShader:FRAG,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false,transparent:true});
      this.reconstructionMaterial.defaultAttributeValues.aSideThickness=[0,0,1];
      this.reconstructionMaterial.defaultAttributeValues.aSideFront=[0,0,0,0];
      this.reconstructionMaterial.defaultAttributeValues.aSideRear=[0,0,0,-1];
      const geometry=new THREE.BufferGeometry();
      for(const [name,key,size] of [['position','positions',3],['aColor','colors',3],['aRand','rands',1],['aOccluder','occluders',4],['aOutward','normals',2]])geometry.setAttribute(name,new THREE.BufferAttribute(hidden[key],size));
      if(hidden.sideFronts)geometry.setAttribute('aSideFront',new THREE.BufferAttribute(hidden.sideFronts,4));
      if(hidden.sideRears)geometry.setAttribute('aSideRear',new THREE.BufferAttribute(hidden.sideRears,4));
      if(hidden.sideThickness)geometry.setAttribute('aSideThickness',new THREE.BufferAttribute(hidden.sideThickness,3));
      this.reconstructionPoints=new THREE.Points(geometry,this.reconstructionMaterial);
      this.reconstructionPoints.frustumCulled=false;this.scene.add(this.reconstructionPoints);
    }
    if(cloud.fillFractions?.length){
      this.fillMaterial ||= new THREE.ShaderMaterial({uniforms:this.uniforms,defines:{GAP_FILL:1},vertexShader:VERT,fragmentShader:FRAG,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false,transparent:true});
      this.fillMaterial.defaultAttributeValues.aFillThickness=[0,0,1];
      this.fillMaterial.defaultAttributeValues.aFillForeground=[0,0,0,0];
      const fill=new THREE.BufferGeometry();
      fill.setAttribute('position',new THREE.BufferAttribute(cloud.positions.subarray(baseCount*3),3));
      fill.setAttribute('aColor',new THREE.BufferAttribute(cloud.colors.subarray(baseCount*3),3));
      fill.setAttribute('aRand',new THREE.BufferAttribute(cloud.rands.subarray(baseCount),1));
      fill.setAttribute('aFillStart',new THREE.BufferAttribute(cloud.fillStarts,4));
      fill.setAttribute('aFillEnd',new THREE.BufferAttribute(cloud.fillEnds,4));
      fill.setAttribute('aFillT',new THREE.BufferAttribute(cloud.fillFractions,1));
      if(cloud.fillThickness)fill.setAttribute('aFillThickness',new THREE.BufferAttribute(cloud.fillThickness,3));
      if(cloud.fillForeground)fill.setAttribute('aFillForeground',new THREE.BufferAttribute(cloud.fillForeground,4));
      this.fillPoints=new THREE.Points(fill,this.fillMaterial);this.fillPoints.frustumCulled=false;
      this.scene.add(this.fillPoints);
    }
    // world spacing between points -> density-aware pixel size for the shader
    const rows = Math.max(1, Math.round(Math.sqrt((cloud.baseCount ?? cloud.count) / cloud.aspect)));
    this.spacingWorld = 1 / rows;
    this.uniforms.uFillSpacing.value = this.spacingWorld;
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
    if(this.points) this.points.visible=v>0;
    if(this.fillPoints) this.fillPoints.visible=v>0;
    if(this.reconstructionPoints)this.reconstructionPoints.visible=v>0 && this.reconstructionEnabled && this.uniforms.uReconstructionBrightness.value>0;
    if(v<=0)this.sideMask.releaseTarget();
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
    // The envelope can reach zero between draws. Render the centred camera
    // once before sleeping, rather than retaining the last offset frame.
    if(this.idleVis===0 && (this.renderedIdleVis!==0 || (this.backdrop && this.renderedBackdropDim!==this.backdropDim)))return false;
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
    this.uniforms.uDepthShape.value = Math.max(0,Math.min(1,s.depthShape ?? 0));
    this.uniforms.uDepthShapeMotion.value = s.depthShapeMotion ? 1 : 0;
    this.uniforms.uDepthShading.value = Math.max(0,Math.min(1,s.depthShading || 0));
    this.uniforms.uDepthShadingMotion.value = s.depthShadingMotion ? 1 : 0;
    this.uniforms.uReconstructionBrightness.value=Math.max(0,Math.min(1,s.reconstructionBrightness ?? .7));
    this.uniforms.uReconstructionOcclusion.value=s.reconstructionOcclusion===false ? 0:1;
    this.sharedSideOcclusion=s.reconstructionSharedOcclusion!==false;
    this.uniforms.uSideMaskFaceCoverage.value=Math.max(0,Math.min(3,s.reconstructionFaceCoverage ?? 0));
    this.uniforms.uSideMaskWallCoverage.value=Math.max(.5,Math.min(3,s.reconstructionWallCoverage ?? 1));
    this.uniforms.uSideMaskDepthTolerance.value=Math.max(0,Math.min(3,s.reconstructionDepthTolerance ?? 1));
    this.uniforms.uReconstructionSideOcclusion.value=this.uniforms.uReconstructionOcclusion.value && s.reconstructionSideOcclusion && this.fillPoints && s.gapFill>0 && (s.gapFillPointLimit ?? 180000)>0 && s.gapFillBrightness>0 ? 1:0;
    this.reconstructionEnabled=!!s.occludedBackground;
    if(this.reconstructionPoints)this.reconstructionPoints.visible=this.uniforms.uVis.value>0 && this.reconstructionEnabled && this.uniforms.uReconstructionBrightness.value>0;
    if(!this.points?.visible || !this.reconstructionEnabled || this.uniforms.uReconstructionSideOcclusion.value<.5 || !this.sharedSideOcclusion)this.sideMask.releaseTarget();
    // Hold approximate light per bridge steady as rows/samples increase.
    this.uniforms.uFillBrightness.value = Math.max(0,Math.min(1,s.gapFillBrightness ?? .35))
      * Math.min(1,12/Math.max(3,s.gapFillDensity ?? 12))
      * Math.min(1,3/Math.max(1,s.gapFillRows ?? 3));
    this.uniforms.uFillOnlyOpen.value = s.gapFillOnlyOpen === false ? 0 : 1;
    this.uniforms.uFillAdaptive.value = Math.max(0,Math.min(1,Number(s.gapFillAdaptive ?? 1)));
    this.uniforms.uFillSamples.value = Math.max(3,Math.min(24,s.gapFillDensity ?? 12));
    this.uniforms.uFillThicknessAuto.value=s.occludedBackground && s.gapFillForegroundLimit ? 1:0;
    this.uniforms.uFillThicknessBias.value=Math.max(.25,Math.min(2.5,s.gapFillThicknessBias ?? 1));
    this.uniforms.uFillThicknessBalance.value=Math.max(0,Math.min(2,s.gapFillThicknessBalance ?? 1));
    this.uniforms.uFillThicknessManual.value=s.occludedBackground && s.gapFillManualLimit ? 1:0;
    this.uniforms.uFillThickness.value=Math.max(0,Math.min(1,s.gapFillThickness ?? .6));
    const depthBandKey=`${s.bands}/${s.bandDistribution||0}`;
    this.uniforms.uSurfaceCohesion.value=s.aiFillThickness && s.bandMap==='depth' && this.surfaceMotion?.surfaceCount ? Math.max(0,Math.min(1,s.surfaceCohesion ?? 0)):0;
    this.uniforms.uSmartDepthBands.value=s.smartDepthBands && this.depthHistogram ? 1:0;
    if(s.smartDepthBands && this.depthHistogram && this.depthBandKey!==depthBandKey){
      const lookup=depthBandLookup(this.depthHistogram,s.bands,s.bandDistribution||0);
      for(let i=0;i<lookup.length;i++)this.depthBandData[i*4]=lookup[i];
      this.depthBandTex.needsUpdate=true;this.depthBandKey=depthBandKey;
    }
    this.uniforms.uLayers.value.set(s.motionWave, s.motionRipple, s.motionBands, s.motionDrift);
    this.uniforms.uExtraLayers.value.set(s.motionSwirl, s.motionBreathe, s.motionSweep, s.motionBandShake);
    this.uniforms.uBandMap.value = BAND_MAPS[s.bandMap] ?? 0;
    this.uniforms.uBandDistribution.value = Math.pow(4, Math.max(-1, Math.min(1,s.bandDistribution || 0)));
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
    // Saved key retained: dynamically centre and fill the screen while
    // preserving full parallax instead of limiting camera travel.
    this.keepScreenCovered = !!s.keepScreenCovered;
    this.fillStrength = s.fillStrength ?? .6;
    this.framingSmoothing = s.framingSmoothing ?? .6;
    this.overscan = 1;
    if ((!this.keepScreenCovered || this.fillStrength===0) && this.dynamicFraming) this.dynamicFraming.zoom = null;
    this.hideBackdrop = !!s.hideBackdrop;
    this.cursorRipple = !!s.cursorRipple;
    this.uniforms.uExitPush.value = s.flybyExit ? 0.4 : 0;
    this.speedVol = s.speedVol;
    this.motionSpeed = s.motionSpeed;
    this.musicParallax = s.musicParallax || 0;
    this.audioCurvature = Math.max(-1,Math.min(1,s.audioCurvature || 0));
    this.curvatureSource=s.curvatureSource==='bands' ? 'bands':'input';
    this.uniforms.uCurvature.value=this.audioCurvature*(this.curvatureDrive ?? this.lensDrive ?? 0)*.65;
    this.dollyZoom = Math.max(0,Math.min(1,s.dollyZoom || 0));
    this.lensInputGain = s.sensGain ?? 1;
    this.lensNoiseFloor = s.sensFloor ?? 0;
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
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2));
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
    // Music parallax: bass-vs-treble and bass changes form a reference vector
    // that cycles direction below, independently of the pointer. The
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
    if(this.audioCurvature || this.dollyZoom){
      // Global lens motion follows calibrated input loudness, not normalized
      // spectrum averages or the quiet-song motion multiplier. Use the input
      // gain/floor but not the contrast curve between individual bands.
      const target=bandResponse(loud,this.lensInputGain,this.lensNoiseFloor,1);
      const current=this.lensDrive ?? 0;
      this.lensDrive=current+(target-current)*(1-Math.exp(-dt/(target>current ? .08:.18)));
    }else this.lensDrive=0;
    if(this.audioCurvature && this.curvatureSource==='bands'){
      const target=Math.max(0,Math.min(1,(Number.isFinite(analyzer.energy) ? analyzer.energy:0)*mamp));
      const current=this.curvatureDrive ?? 0;
      this.curvatureDrive=current+(target-current)*(1-Math.exp(-dt/(target>current ? .18:.45)));
    }else this.curvatureDrive=this.audioCurvature ? this.lensDrive:0;
    this.uniforms.uCurvature.value=this.audioCurvature*(this.curvatureDrive || 0)*.65;
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
    const direction = this.musicDirection ??= new MusicParallaxDirection();
    const musicActive = mp > 0 && Math.max(bandResponse(loud, this.lensInputGain, this.lensNoiseFloor, 1), analyzer.energy || 0) > .002;
    direction.update(dt, musicActive, this.musicPx ?? 0, -(this.musicPy ?? 0) * 1.4);
    this.camera.position.x = Math.sin(t * 0.13) * p * 0.6 * drift + this.pointer.x * p + direction.x * mp * mamp;
    this.camera.position.y = Math.cos(t * 0.11) * p * 0.4 * drift - this.pointer.y * p * 0.6 + direction.y * mp * mamp;

    // cursor ripple: strength rises with cursor speed, decays when it stops
    const spd = Math.hypot(this.pointer.tx - (this._prevNx ?? 0), this.pointer.ty - (this._prevNy ?? 0)) / Math.max(dt, 0.001);
    this._prevNx = this.pointer.tx;
    this._prevNy = this.pointer.ty;
    this.cursorStrength = Math.min(1, (this.cursorStrength ?? 0) * Math.exp(-dt / 0.3) + spd * 0.12);
    const rippleOn = this.cursorRipple ? 1 : 0;
    const halfH = tanHalf * this.camBaseZ;
    this.uniforms.uCursor.value.set(
      this.pointer.x * halfH * this.camera.aspect * 2,
      -this.pointer.y * halfH * 2,
      this.cursorStrength * rippleOn,
    );
    // Retreat from the safe position instead of approaching into framing's
    // safety clamp. Compensating FOV preserves the reference-plane size.
    const lensScale=1+this.dollyZoom*(this.lensDrive || 0)*.55;
    const lensBaseZ=this.camBaseZ*lensScale;
    const lensFov= this.dollyZoom ? THREE.MathUtils.radToDeg(2*Math.atan(tanHalf/lensScale)):this.baseFov;
    if(this.camera.fov!==lensFov){this.camera.fov=lensFov;this.camera.updateProjectionMatrix();}
    this.camera.position.z = lensBaseZ;
    this.camera.lookAt(0, 0, 0.1);
    if (this.keepScreenCovered && this.fillStrength>0 && this.dynamicFraming && this.uniforms.uVis.value > 0) {
      this.dynamicFraming.update(this.camera, this.camBaseZ, this.uniforms, this.bandData, dt, this.fillStrength, this.framingSmoothing,lensScale);
      this.uniforms.uCamZ.value = this.camera.position.z;
      this.uniforms.uSize.value = (this.pointSizeSetting || 1) * hPx * (this.spacingWorld || 1 / 300)
        * this.camera.zoom / (2 * Math.tan(THREE.MathUtils.degToRad(lensFov/2)) * this.camera.position.z);
    } else if (this.camera.zoom !== 1 || this.camera.projectionMatrix.elements[8] !== 0 || this.camera.projectionMatrix.elements[9] !== 0) {
      this.camera.zoom = 1;
      this.camera.updateProjectionMatrix();
    }
    if(this.dollyZoom && !(this.keepScreenCovered && this.fillStrength>0 && this.dynamicFraming && this.uniforms.uVis.value>0)){
      this.uniforms.uCamZ.value=this.camera.position.z;
      this.uniforms.uSize.value=(this.pointSizeSetting || 1)*hPx*(this.spacingWorld || 1/300)
        /(2*Math.tan(THREE.MathUtils.degToRad(lensFov/2))*this.camera.position.z);
    }

    this._settleIdleCamera(hPx);
    this.prepareSideMask();
    this.renderer.render(this.scene, this.camera);
    this.renderedIdleVis=this.idleVis ?? 1;
    this.renderedBackdropDim=this.backdropDim;
    this.drawCrossfade(performance.now());
    return dt;
  }

  prepareSideMask() {
    this.sideMask.render(this.renderer,this.camera,!!(this.points?.visible && this.reconstructionEnabled && this.uniforms.uReconstructionSideOcclusion.value>.5 && this.sharedSideOcclusion));
  }

  _settleIdleCamera(hPx) {
    const v=Math.max(0,Math.min(1,this.idleVis ?? 1));
    if(v===1)return;
    // Fade the complete camera pose back to the original wallpaper fit.
    // Pointer, music tilt, dolly and framing all need a neutral idle endpoint.
    const motion=v*v*(3-2*v),camera=this.camera;
    const offsetX=camera.projectionMatrix.elements[8]*motion;
    const offsetY=camera.projectionMatrix.elements[9]*motion;
    camera.position.x*=motion;camera.position.y*=motion;
    camera.position.z=this.camBaseZ+(camera.position.z-this.camBaseZ)*motion;
    camera.fov=this.baseFov+(camera.fov-this.baseFov)*motion;
    camera.zoom=1+(camera.zoom-1)*motion;
    camera.lookAt(0,0,.1);camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[8]=offsetX;camera.projectionMatrix.elements[9]=offsetY;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    this.uniforms.uCamZ.value=camera.position.z;
    this.uniforms.uSize.value=(this.pointSizeSetting || 1)*hPx*(this.spacingWorld || 1/300)*camera.zoom
      /(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.position.z);
  }

  beginCrossfade(seconds) {
    if (!this.points || !(seconds>0)) { this.endCrossfade(); return; }
    // Capture on the GPU immediately after drawing; the default framebuffer
    // is not preserved between frames. Include any unfinished prior blend.
    this.prepareSideMask();
    this.renderer.render(this.scene,this.camera);
    this.drawCrossfade(performance.now());
    const size=this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const texture=new THREE.FramebufferTexture(size.x,size.y);
    this.renderer.copyFramebufferToTexture(texture);
    this.endCrossfade();
    const material=new THREE.ShaderMaterial({
      uniforms:{uTex:{value:texture},uOpacity:{value:1}},
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader:'uniform sampler2D uTex; uniform float uOpacity; varying vec2 vUv; void main(){gl_FragColor=vec4(texture2D(uTex,vUv).rgb,uOpacity);}',
      transparent:true,depthTest:false,depthWrite:false,
    });
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);
    mesh.frustumCulled=false;
    const overlay=new THREE.Scene();overlay.add(mesh);
    this.crossfade={texture,material,mesh,overlay,camera:new THREE.Camera(),start:performance.now(),duration:seconds*1000};
  }

  drawCrossfade(now) {
    const fade=this.crossfade;
    if (!fade) return;
    const t=Math.max(0,Math.min(1,(now-fade.start)/fade.duration));
    if(t>=1){this.endCrossfade();return;}
    fade.material.uniforms.uOpacity.value=1-t*t*(3-2*t);
    const clear=this.renderer.autoClear;this.renderer.autoClear=false;
    this.renderer.render(fade.overlay,fade.camera);this.renderer.autoClear=clear;
  }

  endCrossfade() {
    if(!this.crossfade)return;
    const {texture,material,mesh}=this.crossfade;
    texture.dispose();material.dispose();mesh.geometry.dispose();this.crossfade=null;
  }
}
