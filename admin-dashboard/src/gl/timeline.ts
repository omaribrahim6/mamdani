import * as THREE from 'three';
import type { View } from './backStage';

// 48 hours of reports (Tiger's reports_hourly continuous aggregate) drawn entirely in a
// fragment shader: a glowing curve, a filled area, and the scrub cursor. Everything after the
// cursor dims, so scrubbing reads as "rewinding the city".

const FRAG = /* glsl */ `
uniform sampler2D uData;
uniform float uMax;
uniform float uCursor;
uniform float uHover;
uniform vec2 uRes;
uniform float uTime;
varying vec2 vUv;
float sampleAt(float x) { return texture2D(uData, vec2(x, 0.5)).r / max(uMax, 1.0); }
void main() {
  vec2 uv = vUv;
  float pad = 0.16;
  float y = (uv.y - pad) / (1.0 - 2.0 * pad);
  float v = sampleAt(uv.x);
  float dv = (sampleAt(uv.x + 1.0 / uRes.x) - sampleAt(uv.x - 1.0 / uRes.x)) * uRes.x * 0.5;
  float plotH = uRes.y * (1.0 - 2.0 * pad);
  float slope = dv * plotH / uRes.x;
  float px = abs(y - v) * plotH / sqrt(1.0 + slope * slope);
  float line = smoothstep(1.6, 0.0, px);
  float glow = exp(-px * px / 60.0) * 0.45;
  float area = step(y, v) * step(0.0, y) * (0.10 + 0.18 * y);
  float past = step(uv.x, uCursor);
  vec3 cream = vec3(0.62, 0.76, 0.94); // GC link blue on dark
  vec3 col = cream * (line + glow) * mix(0.28, 1.0, past) + cream * area * mix(0.25, 1.0, past);
  // hour ticks
  float tick = step(0.985, fract(uv.x * 48.0)) * step(uv.y, 0.1) * 0.3;
  float day = step(0.9965, fract(uv.x * 2.0)) * 0.35;
  col += cream * (tick + day);
  // cursor
  float cx = abs(uv.x - uCursor) * uRes.x;
  col += cream * smoothstep(1.5, 0.0, cx) * 0.9;
  col += cream * exp(-cx * cx / 40.0) * 0.25 * (0.7 + 0.3 * sin(uTime * 3.0));
  float hx = abs(uv.x - uHover) * uRes.x;
  col += cream * smoothstep(1.0, 0.0, hx) * 0.25 * step(0.0, uHover);
  float a = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}`;

export class Timeline implements View {
  clip: HTMLElement | null = null;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private tex: THREE.DataTexture;

  constructor(public el: HTMLElement) {
    this.tex = new THREE.DataTexture(new Float32Array(48 * 4), 48, 1, THREE.RGBAFormat, THREE.FloatType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = THREE.ClampToEdgeWrapping;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      uniforms: { uData: { value: this.tex }, uMax: { value: 1 }, uCursor: { value: 1 }, uHover: { value: -1 }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
  }

  setData(counts: number[]) {
    const d = this.tex.image.data as Float32Array;
    counts.slice(-48).forEach((c, i) => { d[i * 4] = c; });
    this.tex.needsUpdate = true;
    this.mat.uniforms.uMax.value = Math.max(1, ...counts) * 1.15;
  }
  setCursor(x: number) { this.mat.uniforms.uCursor.value = x; }
  setHover(x: number) { this.mat.uniforms.uHover.value = x; }

  render(r: THREE.WebGLRenderer, t: number, _dt: number, w: number, h: number) {
    this.mat.uniforms.uRes.value.set(w, h);
    this.mat.uniforms.uTime.value = t;
    r.render(this.scene, this.cam);
  }
}
