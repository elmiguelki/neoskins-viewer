import { Vector2 } from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { SkinViewer } from "skinview3d";

export interface SkinViewerEnhanceOptions {
  /**
   * Device pixel ratio multiplier for crisp, super-sampled rendering.
   * @default Math.min(window.devicePixelRatio || 1, 2)
   */
  pixelRatio?: number;
  /**
   * Brightness multiplier for the outline (same color brightened).
   * @default 1.35 (35% brighter)
   */
  brightnessBoost?: number;
  /**
   * Additive brightness value to lift darker colors.
   * @default 0.1
   */
  brightnessOffset?: number;
  /**
   * Outline thickness in screen pixels.
   * @default 1.3
   */
  outlineThickness?: number;
  /**
   * Whether the outline effect is enabled.
   * @default true
   */
  enabled?: boolean;
}

export interface SkinViewerEnhancement {
  outlinePass: ShaderPass;
  setBrightnessBoost: (boost: number, offset?: number) => void;
  setOutlineThickness: (thickness: number) => void;
  setEnabled: (enabled: boolean) => void;
  dispose: () => void;
}

/**
 * Bedrock-style Outline Shader for Three.js / skinview3d.
 * Produces an edge highlight of the skin's own color, slightly lighter with a brightness boost.
 * Completely eliminates perspective darkening and preserves 100% background transparency.
 */
const OutlineShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new Vector2(512, 512) },
    uOutlineThickness: { value: 1.3 },
    uBrightnessBoost: { value: 1.35 },
    uBrightnessOffset: { value: 0.1 },
    uEnabled: { value: true },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uOutlineThickness;
    uniform float uBrightnessBoost;
    uniform float uBrightnessOffset;
    uniform bool uEnabled;

    varying vec2 vUv;

    void main() {
      vec4 baseColor = texture2D(tDiffuse, vUv);

      if (!uEnabled) {
        gl_FragColor = baseColor;
        return;
      }

      vec2 texelSize = 1.0 / uResolution;

      // 8-sample neighborhood (cardinal + diagonal)
      vec2 offsets[8];
      offsets[0] = vec2(-1.0,  0.0);
      offsets[1] = vec2( 1.0,  0.0);
      offsets[2] = vec2( 0.0, -1.0);
      offsets[3] = vec2( 0.0,  1.0);
      offsets[4] = vec2(-0.7071, -0.7071);
      offsets[5] = vec2( 0.7071, -0.7071);
      offsets[6] = vec2(-0.7071,  0.7071);
      offsets[7] = vec2( 0.7071,  0.7071);

      float minNeighborAlpha = 1.0;
      float maxNeighborAlpha = 0.0;
      vec3 neighborRgbSum = vec3(0.0);
      float solidNeighborCount = 0.0;

      for (int i = 0; i < 8; i++) {
        vec2 sampleUv = vUv + offsets[i] * (uOutlineThickness * texelSize);
        vec4 nc = texture2D(tDiffuse, sampleUv);
        minNeighborAlpha = min(minNeighborAlpha, nc.a);
        maxNeighborAlpha = max(maxNeighborAlpha, nc.a);
        if (nc.a > 0.35) {
          neighborRgbSum += nc.rgb;
          solidNeighborCount += 1.0;
        }
      }

      // Outer silhouette: center is transparent, but adjacent to the model
      float outerSilhouette = 0.0;
      if (baseColor.a < 0.65 && maxNeighborAlpha > 0.25) {
        outerSilhouette = smoothstep(0.0, 0.7, maxNeighborAlpha - baseColor.a);
      }

      // Inner silhouette: on the border of the model adjacent to background
      float innerSilhouette = 0.0;
      if (baseColor.a >= 0.2 && minNeighborAlpha < 0.45) {
        innerSilhouette = smoothstep(0.0, 0.7, baseColor.a - minNeighborAlpha);
      }

      // 1. Outside the model (empty canvas background)
      if (baseColor.a < 0.005) {
        if (outerSilhouette > 0.005 && solidNeighborCount > 0.0) {
          vec3 avgColor = neighborRgbSum / solidNeighborCount;
          // Slightly lighter / same color with brightness adjustment
          vec3 brightColor = clamp(avgColor * uBrightnessBoost + vec3(uBrightnessOffset), 0.0, 1.0);
          float alpha = clamp(outerSilhouette * 0.95, 0.0, 1.0);
          gl_FragColor = vec4(brightColor, alpha);
        } else {
          // Zero alpha and zero RGB completely avoids any dark box/rectangle in background
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
        return;
      }

      // 2. On the 3D model:
      // High-contrast crease detection for overlapping limbs/accessories
      float crease = 0.0;
      if (baseColor.a > 0.5 && solidNeighborCount >= 7.0) {
        vec3 cL = texture2D(tDiffuse, vUv + vec2(-1.0,  0.0) * (uOutlineThickness * texelSize)).rgb;
        vec3 cR = texture2D(tDiffuse, vUv + vec2( 1.0,  0.0) * (uOutlineThickness * texelSize)).rgb;
        vec3 cU = texture2D(tDiffuse, vUv + vec2( 0.0,  1.0) * (uOutlineThickness * texelSize)).rgb;
        vec3 cD = texture2D(tDiffuse, vUv + vec2( 0.0, -1.0) * (uOutlineThickness * texelSize)).rgb;
        float diffH = length(cL - cR);
        float diffV = length(cU - cD);
        crease = smoothstep(0.32, 0.65, max(diffH, diffV)) * 0.35;
      }

      float totalHighlight = clamp(innerSilhouette * 0.9 + crease, 0.0, 1.0);
      vec3 brightColor = clamp(baseColor.rgb * uBrightnessBoost + vec3(uBrightnessOffset), 0.0, 1.0);
      vec3 finalRgb = mix(baseColor.rgb, brightColor, totalHighlight);

      gl_FragColor = vec4(finalRgb, baseColor.a);
    }
  `,
};

/**
 * Enhances a skinview3d SkinViewer instance by:
 * 1. Tuning high-DPI pixel ratio for sharp anti-aliased geometry.
 * 2. Applying a Minecraft Bedrock-style outline shader with brightened same-color edge illumination.
 * 3. Ensuring 100% transparent canvas backgrounds without artifacts.
 */
export function enhanceSkinViewer(
  viewer: SkinViewer,
  options: SkinViewerEnhanceOptions = {},
): SkinViewerEnhancement {
  // 1. Pixel ratio calibration for clean edges
  const targetPixelRatio =
    options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2);
  if (viewer.renderer) {
    viewer.renderer.setPixelRatio(targetPixelRatio);
  }

  // 2. Create Outline Shader Pass
  const outlinePass = new ShaderPass(OutlineShader as any);
  outlinePass.renderToScreen = false;

  outlinePass.uniforms["uOutlineThickness"].value =
    options.outlineThickness ?? 1.3;
  outlinePass.uniforms["uBrightnessBoost"].value =
    options.brightnessBoost ?? 1.35;
  outlinePass.uniforms["uBrightnessOffset"].value =
    options.brightnessOffset ?? 0.1;
  outlinePass.uniforms["uEnabled"].value = options.enabled ?? true;

  // Insert before FXAA pass so FXAA anti-aliases the outlined edges
  const composer = viewer.composer;
  if (composer && Array.isArray(composer.passes)) {
    const fxaaIdx = composer.passes.indexOf(viewer.fxaaPass);
    if (fxaaIdx !== -1) {
      composer.passes.splice(fxaaIdx, 0, outlinePass as any);
    } else {
      composer.addPass(outlinePass as any);
    }
  }

  // Hook resize updates
  const viewerAny = viewer as any;
  const originalUpdateComposerSize = viewerAny.updateComposerSize?.bind(viewer);

  const updateSize = () => {
    if (originalUpdateComposerSize) {
      originalUpdateComposerSize();
    }
    const pr = viewer.renderer?.getPixelRatio() || 1;
    const w = (viewer.width || 1) * pr;
    const h = (viewer.height || 1) * pr;
    outlinePass.uniforms["uResolution"].value.set(w, h);
  };

  viewerAny.updateComposerSize = updateSize;
  updateSize();

  const setBrightnessBoost = (boost: number, offset = 0.1) => {
    outlinePass.uniforms["uBrightnessBoost"].value = boost;
    outlinePass.uniforms["uBrightnessOffset"].value = offset;
  };

  const setOutlineThickness = (thickness: number) => {
    outlinePass.uniforms["uOutlineThickness"].value = thickness;
  };

  const setEnabled = (enabled: boolean) => {
    outlinePass.uniforms["uEnabled"].value = enabled;
  };

  const dispose = () => {
    if (composer && Array.isArray(composer.passes)) {
      const idx = composer.passes.indexOf(outlinePass as any);
      if (idx !== -1) {
        composer.passes.splice(idx, 1);
      }
    }
    outlinePass.dispose();
    if (originalUpdateComposerSize) {
      viewerAny.updateComposerSize = originalUpdateComposerSize;
    }
  };

  return {
    outlinePass,
    setBrightnessBoost,
    setOutlineThickness,
    setEnabled,
    dispose,
  };
}
