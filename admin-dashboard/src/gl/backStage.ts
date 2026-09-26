import * as THREE from 'three';

// One WebGL canvas behind the whole console. It paints the asphalt backdrop, then every
// registered "view" (the city table, the timeline) into the screen rectangle of its DOM host
// using the scissor test. One context for everything keeps an integrated GPU comfortable.

export interface View {
  el: HTMLElement;
  /** optional element whose box clips the view (scroll containers) */
  clip?: HTMLElement | null;
  render(renderer: THREE.WebGLRenderer, t: number, dt: number, w: number, h: number): void;
}

const BG_FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform vec2 uMouse;
uniform float uTime;
uniform float uCalm;
varying vec2 vUv;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

void main() {
  vec2 px = vUv * uRes;
  // coarse tar and fine aggregate
  float tar = fbm(px / 420.0 + uTime * 0.004);
  float agg = hash(floor(px / 1.5));
  float stone = step(0.985, hash(floor(px / 3.0) + 7.0));
  vec3 col = vec3(0.012, 0.070, 0.135); // navy night asphalt
  col += (tar - 0.5) * 0.030;
  col += (agg - 0.5) * 0.018;
  col += stone * 0.035;
  // a faded lane line that runs diagonally behind everything
  vec2 q = px / uRes.y;
  float lane = abs(fract((q.x * 0.35 + q.y * 0.9) * 1.6) - 0.5);
  float dash = step(0.5, fract((q.x * 0.9 - q.y * 0.35) * 5.0));
  col += vec3(1.0, 0.67, 0.0) * smoothstep(0.012, 0.0, lane) * dash * 0.035 * fbm(px / 60.0);
  // streetlight pool that follows the cursor, slow and warm
  float d = distance(px, uMouse);
  col += vec3(1.0, 0.67, 0.0) * exp(-d * d / (2.0 * 380.0 * 380.0)) * 0.06 * uCalm;
  // vignette
  vec2 c = vUv - 0.5;
  col *= 1.0 - dot(c, c) * 0.9;
  // film grain, animated
  col += (hash(px + fract(uTime) * 91.0) - 0.5) * 0.012;
  gl_FragColor = vec4(col, 1.0);
}`;

export class BackStage {
  readonly renderer: THREE.WebGLRenderer;
  private views = new Set<View>();
  private bg: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private bgScene = new THREE.Scene();
  private bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mouse = new THREE.Vector2(-9999, -9999);
  private smoothMouse = new THREE.Vector2(-9999, -9999);
  private raf = 0;
  private last = performance.now();
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.bg = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: BG_FRAG,
        uniforms: { uRes: { value: new THREE.Vector2() }, uMouse: { value: this.mouse.clone() }, uTime: { value: 0 }, uCalm: { value: 1 } },
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.bgScene.add(this.bg);
    addEventListener('pointermove', this.onMove, { passive: true });
    this.loop();
  }

  private onMove = (e: PointerEvent) => {
    this.mouse.set(e.clientX, innerHeight - e.clientY);
    if (this.smoothMouse.x < -9000) this.smoothMouse.copy(this.mouse);
  };

  add(view: View) { this.views.add(view); return () => this.views.delete(view); }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = now / 1000;
    const r = this.renderer;
    const w = innerWidth, h = innerHeight;
    const size = r.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) r.setSize(w, h, false);

    this.smoothMouse.lerp(this.mouse, this.reduced ? 1 : 0.06);
    const u = this.bg.material.uniforms;
    u.uRes.value.set(w * r.getPixelRatio(), h * r.getPixelRatio());
    u.uMouse.value.copy(this.smoothMouse).multiplyScalar(r.getPixelRatio());
    u.uTime.value = this.reduced ? 0 : t;

    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.clear();
    r.render(this.bgScene, this.bgCam);

    for (const v of this.views) {
      const b = v.el.getBoundingClientRect();
      let left = b.left, top = b.top, right = b.right, bottom = b.bottom;
      if (v.clip) {
        const c = v.clip.getBoundingClientRect();
        left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
      }
      if (right - left < 2 || bottom - top < 2 || bottom < 0 || top > h) continue;
      r.setViewport(b.left, h - b.bottom, b.width, b.height);
      r.setScissor(left, h - bottom, right - left, bottom - top);
      r.setScissorTest(true);
      r.clearDepth();
      v.render(r, t, dt, b.width, b.height);
    }
    r.setScissorTest(false);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('pointermove', this.onMove);
    this.renderer.dispose();
  }
}
