import * as THREE from 'three';
import type { View } from './backStage';

// The resident's photo as city evidence. It develops in with a scan line, then Gemini's
// bounding box is sprayed on like a road-crew stencil in the category's marking colour.
// Everything outside the box desaturates so staff see the problem first. The photo leans
// slightly towards the cursor.

const FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform float uHasTex;
uniform vec2 uRes;
uniform vec2 uImg;
uniform vec4 uBox;     // ymin, xmin, ymax, xmax in 0..1
uniform float uHasBox;
uniform vec3 uColor;
uniform float uT;      // seconds since shown
uniform float uTime;
uniform vec2 uMouse;   // -1..1
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
void main() {
  // cover-fit the image, with a small parallax push towards the cursor
  float ra = uRes.x / uRes.y, ia = uImg.x / uImg.y;
  vec2 uv = vUv - 0.5;
  if (ra > ia) uv.y *= ia / ra; else uv.x *= ra / ia;
  uv = uv * 0.94 + uMouse * 0.015 + 0.5;
  vec2 iuv = vec2(uv.x, 1.0 - uv.y); // image space, top-down (matches Gemini boxes)

  float reveal = clamp(uT / 0.9, 0.0, 1.0);
  vec3 photo = vec3(0.1);
  if (uHasTex > 0.5) {
    float ab = (1.0 - reveal) * 0.006;
    photo = vec3(texture2D(uTex, uv + vec2(ab, 0.0)).r, texture2D(uTex, uv).g, texture2D(uTex, uv - vec2(ab, 0.0)).b);
  }
  float shown = step(iuv.y, reveal);
  vec3 col = mix(vec3(0.07, 0.07, 0.065), photo, shown);
  col += vec3(1.0, 0.67, 0.0) * exp(-pow((iuv.y - reveal) * uRes.y, 2.0) / 20.0) * (1.0 - reveal) * 0.9;

  if (uHasBox > 0.5) {
    vec2 c = vec2((uBox.y + uBox.w) * 0.5, (uBox.x + uBox.z) * 0.5);
    vec2 half_ = vec2(uBox.w - uBox.y, uBox.z - uBox.x) * 0.5;
    vec2 p = (iuv - c) * uImg / uImg.y;
    vec2 hb = half_ * uImg / uImg.y;
    float d = sdBox(p, hb);
    float focus = smoothstep(0.0, 0.03, d) * smoothstep(0.6, 1.4, uT);
    float g = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(g) * 0.55, focus * 0.75);
    // perimeter progress for the spray-on
    vec2 q = p / hb;
    float ang = atan(q.y, q.x) / 6.2831853 + 0.5;
    float draw = clamp((uT - 1.0) / 0.9, 0.0, 1.0);
    float onPath = step(ang, draw);
    float w = 0.012 + 0.006 * noise(p * 40.0);
    float ring = smoothstep(w, w * 0.4, abs(d));
    float speck = step(0.55, hash(floor(p * 900.0))) * exp(-abs(d) * 60.0);
    float spray = clamp(ring + speck * 0.7, 0.0, 1.0) * onPath;
    float drip = step(abs(p.x - hb.x * 0.6), 0.004) * step(hb.y, p.y) * step(p.y, hb.y + 0.05 * clamp((uT - 1.9) / 0.6, 0.0, 1.0));
    col = mix(col, uColor * (0.9 + 0.2 * noise(p * 80.0)), max(spray, drip));
  }
  // grain
  col += (hash(vUv * uRes + fract(uTime) * 50.0) - 0.5) * 0.03;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class Evidence implements View {
  clip: HTMLElement | null = null;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private shownAt = performance.now() / 1000;
  private mouse = new THREE.Vector2();
  private target = new THREE.Vector2();

  constructor(public el: HTMLElement) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: null }, uHasTex: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uImg: { value: new THREE.Vector2(4, 3) },
        uBox: { value: new THREE.Vector4() }, uHasBox: { value: 0 }, uColor: { value: new THREE.Color() }, uT: { value: 0 }, uTime: { value: 0 },
        uMouse: { value: this.mouse },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
    el.addEventListener('pointermove', (e) => {
      const b = el.getBoundingClientRect();
      this.target.set(((e.clientX - b.left) / b.width) * 2 - 1, -(((e.clientY - b.top) / b.height) * 2 - 1));
    });
    el.addEventListener('pointerleave', () => this.target.set(0, 0));
  }

  show(url: string | null, box: [number, number, number, number] | null, color: string) {
    const u = this.mat.uniforms;
    u.uColor.value.set(color);
    u.uHasBox.value = box ? 1 : 0;
    if (box) u.uBox.value.set(box[0] / 1000, box[1] / 1000, box[2] / 1000, box[3] / 1000);
    u.uHasTex.value = 0;
    this.shownAt = performance.now() / 1000;
    if (!url) return;
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const img = tex.image as HTMLImageElement;
      u.uImg.value.set(img.width, img.height);
      (u.uTex.value as THREE.Texture | null)?.dispose();
      u.uTex.value = tex;
      u.uHasTex.value = 1;
      this.shownAt = performance.now() / 1000;
    });
  }

  render(r: THREE.WebGLRenderer, t: number, dt: number, w: number, h: number) {
    this.mouse.lerp(this.target, Math.min(1, dt * 5));
    const u = this.mat.uniforms;
    u.uRes.value.set(w, h);
    u.uT.value = t - this.shownAt;
    u.uTime.value = t;
    r.render(this.scene, this.cam);
  }
}

/** The evidence viewer sits inside an opaque panel, so it gets its own small canvas. */
export class EvidenceCanvas {
  readonly view: Evidence;
  private renderer: THREE.WebGLRenderer;
  private raf = 0;
  private last = performance.now();
  constructor(host: HTMLElement, canvas: HTMLCanvasElement) {
    this.view = new Evidence(host);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      const s = this.renderer.getSize(new THREE.Vector2());
      if (s.x !== w || s.y !== h) this.renderer.setSize(w, h, false);
      this.view.render(this.renderer, now / 1000, dt, w, h);
    };
    loop();
  }
  dispose() { cancelAnimationFrame(this.raf); this.renderer.dispose(); this.renderer.forceContextLoss(); }
}
