import * as THREE from 'three';

// One transparent WebGL canvas over the dashboard (pointer-events: none), created on first use.
// It draws what the DOM can't: a heat shimmer around work orders that are late or about to be,
// and a sweep across a row the moment it's marked fixed (played on the row's last position,
// because the queue drops resolved rows right away).

const FRAME_FRAG = /* glsl */ `
uniform vec2 uSize;
uniform vec3 uColor;
uniform float uHeat;
uniform float uTime;
uniform float uPad;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float d = sdRound(p, uSize * 0.5 - uPad, 10.0);
  float speed = 0.5 + uHeat * 2.5;
  float along = p.x / uSize.x * 6.0 + p.y / uSize.y * 2.0;
  float flick = noise(vec2(along * 2.0 + uTime * speed, uTime * speed * 0.6)) * 0.7 + noise(vec2(along * 7.0 - uTime * speed * 1.6, 5.0)) * 0.3;
  float band = exp(-max(d, 0.0) * max(d, 0.0) / (10.0 + 26.0 * uHeat)) * step(-1.0, d);
  float edge = smoothstep(1.2, 0.0, abs(d));
  float a = (band * (0.15 + 0.45 * flick) + edge * (0.25 + 0.45 * flick)) * uHeat;
  gl_FragColor = vec4(uColor, clamp(a, 0.0, 0.9));
}`;

const SWEEP_FRAG = /* glsl */ `
uniform vec2 uSize;
uniform float uT;
uniform vec3 uColor;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float x = vUv.x + (hash(floor(vUv * uSize / 6.0)) - 0.5) * 0.04;
  float front = uT * 1.25 - 0.1;
  float glow = smoothstep(0.12, 0.0, abs(x - front));
  float wake = step(x, front) * (1.0 - uT) * 0.22;
  float a = (glow * 0.85 + wake) * smoothstep(1.0, 0.8, uT);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), glow * 0.5), a);
}`;

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';

interface Frame { el: HTMLElement; clip: HTMLElement | null; mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; heat: number }
interface Sweep { rect: DOMRect; mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; t: number }

class Overlay {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
  private frames = new Map<HTMLElement, Frame>();
  private sweeps: Sweep[] = [];
  private raf = 0;
  private last = performance.now();
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '40' });
    document.body.appendChild(canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.loop();
  }

  frame(el: HTMLElement, clip: HTMLElement | null, color: string, heat: number) {
    let f = this.frames.get(el);
    if (!f) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
        transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uSize: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color() }, uHeat: { value: 0 }, uTime: { value: 0 }, uPad: { value: 8 } },
        vertexShader: VERT, fragmentShader: FRAME_FRAG,
      }));
      this.scene.add(mesh);
      f = { el, clip, mesh, heat };
      this.frames.set(el, f);
    }
    f.clip = clip;
    f.heat = heat;
    f.mesh.material.uniforms.uColor.value.set(color);
    return () => {
      const cur = this.frames.get(el);
      if (!cur) return;
      this.scene.remove(cur.mesh);
      cur.mesh.material.dispose();
      this.frames.delete(el);
    };
  }

  sweep(rect: DOMRect, color: string) {
    if (this.reduced) return;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uSize: { value: new THREE.Vector2(rect.width, rect.height) }, uT: { value: 0 }, uColor: { value: new THREE.Color(color) } },
      vertexShader: VERT, fragmentShader: SWEEP_FRAG,
    }));
    mesh.position.set(rect.left + rect.width / 2, rect.top + rect.height / 2, 0);
    mesh.scale.set(rect.width, -rect.height, 1);
    this.scene.add(mesh);
    this.sweeps.push({ rect, mesh, t: 0 });
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const w = innerWidth, h = innerHeight;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) this.renderer.setSize(w, h, false);
    this.cam.right = w; this.cam.bottom = h; this.cam.updateProjectionMatrix();

    for (const f of this.frames.values()) {
      const b = f.el.getBoundingClientRect();
      const c = f.clip?.getBoundingClientRect();
      const inside = b.width > 0 && b.bottom > 0 && b.top < h && (!c || (b.bottom > c.top && b.top < c.bottom));
      f.mesh.visible = inside && f.heat > 0.01;
      if (!f.mesh.visible) continue;
      const pad = 8;
      f.mesh.position.set(b.left + b.width / 2, b.top + b.height / 2, 0);
      f.mesh.scale.set(b.width + pad * 2, -(b.height + pad * 2), 1);
      const u = f.mesh.material.uniforms;
      u.uSize.value.set(b.width + pad * 2, b.height + pad * 2);
      u.uHeat.value += (f.heat - u.uHeat.value) * Math.min(1, dt * 3);
      u.uTime.value = this.reduced ? 0 : now / 1000;
    }
    for (const s of this.sweeps) { s.t += dt / 0.9; s.mesh.material.uniforms.uT.value = s.t; }
    this.sweeps = this.sweeps.filter((s) => {
      if (s.t < 1) return true;
      this.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose();
      return false;
    });
    this.renderer.clear();
    if (this.frames.size || this.sweeps.length) this.renderer.render(this.scene, this.cam);
  };
}

let overlay: Overlay | null | undefined;
/** The shared overlay, or null where WebGL isn't available (tests, old browsers). */
export function fx(): Overlay | null {
  if (overlay !== undefined) return overlay;
  try {
    const c = document.createElement('canvas');
    overlay = c.getContext('webgl2') || c.getContext('webgl') ? new Overlay() : null;
  } catch {
    overlay = null;
  }
  return overlay;
}
