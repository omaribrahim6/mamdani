import * as THREE from 'three';

// A transparent WebGL layer over the console (pointer-events: none). It draws what the DOM
// can't: the heat shimmer around urgent tickets, the particles that fly into a ticket when a
// duplicate report merges, and the burn-away when a ticket is resolved.

const FRAME_FRAG = /* glsl */ `
uniform vec2 uSize;
uniform vec3 uColor;
uniform float uUrg;
uniform float uFlash;
uniform float uTime;
uniform float uPad;
uniform float uBurn;
uniform vec3 uBg;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  vec2 inner = uSize * 0.5 - uPad;
  float d = sdRound(p, inner, 7.0);
  vec4 outc = vec4(0.0);

  // heat shimmer: a flickering band along the border, faster as the deadline closes in
  if (uUrg > 0.02 || uFlash > 0.0) {
    float ang = atan(p.y, p.x);
    float speed = 0.6 + uUrg * 3.5;
    float flick = noise(vec2(ang * 3.0 + uTime * speed, uTime * speed * 0.7)) * 0.7 + noise(vec2(ang * 9.0 - uTime * speed * 1.7, 3.0)) * 0.3;
    float band = exp(-max(d, 0.0) * max(d, 0.0) / (18.0 + 40.0 * uUrg)) * step(-1.5, d);
    float edge = smoothstep(1.4, 0.0, abs(d));
    float a = band * (0.18 + 0.55 * flick) * uUrg + edge * (0.25 + 0.5 * uUrg) * flick + uFlash * (band * 0.9 + edge);
    outc = vec4(uColor * (0.8 + flick * 0.6), clamp(a, 0.0, 1.0) * 0.85);
  }

  // burn-away on resolve: cover the ticket with the page colour behind a noisy, glowing front
  if (uBurn > 0.0 && d < 0.0) {
    float n = noise(p / 18.0) * 0.65 + noise(p / 5.0) * 0.35;
    float front = (vUv.x * 0.7 + (1.0 - vUv.y) * 0.3) * 0.75 + n * 0.35;
    float burnt = step(front, uBurn * 1.15);
    float glowEdge = smoothstep(0.06, 0.0, abs(front - uBurn * 1.15));
    vec3 green = vec3(0.16, 0.62, 0.35); // GC success green front
    vec3 c = mix(outc.rgb, uBg, burnt);
    c += green * glowEdge * 1.4 + vec3(0.9, 1.0, 0.95) * glowEdge * glowEdge * 0.9;
    outc = vec4(c, max(max(outc.a, burnt), glowEdge));
  }
  gl_FragColor = outc;
}`;

interface Frame {
  el: HTMLElement;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  urg: number;
  flash: number;
  burn: number;
  onBurnt?: () => void;
}

interface Burst {
  pts: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  from: THREE.Vector2[];
  ctrl: THREE.Vector2[];
  delay: Float32Array;
  target: HTMLElement;
  t: number;
  onLand?: () => void;
  landed: boolean;
}

export class FxStage {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
  private frames = new Map<HTMLElement, Frame>();
  private bursts: Burst[] = [];
  private clipEl: HTMLElement | null = null;
  private raf = 0;
  private last = performance.now();
  private bg = new THREE.Color('#1b2633'); // must match --surface (queue background)

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.loop();
  }

  setClip(el: HTMLElement | null) { this.clipEl = el; }

  frame(el: HTMLElement, color: string, urg: number) {
    let f = this.frames.get(el);
    if (!f) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
        uniforms: {
          uSize: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color() }, uUrg: { value: 0 }, uFlash: { value: 0 },
          uTime: { value: 0 }, uPad: { value: 14 }, uBurn: { value: 0 }, uBg: { value: this.bg },
        },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: FRAME_FRAG,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      this.scene.add(mesh);
      f = { el, mesh, urg, flash: 0, burn: 0 };
      this.frames.set(el, f);
    }
    f.mesh.material.uniforms.uColor.value.set(color);
    f.urg = urg;
    return () => {
      const cur = this.frames.get(el);
      if (cur && cur.burn === 0) {
        this.scene.remove(cur.mesh);
        cur.mesh.material.dispose();
        this.frames.delete(el);
      }
    };
  }

  flash(el: HTMLElement) { const f = this.frames.get(el); if (f) f.flash = 1; }

  burn(el: HTMLElement, onBurnt: () => void) {
    const f = this.frames.get(el);
    if (!f) { onBurnt(); return; }
    f.burn = 0.001;
    f.onBurnt = onBurnt;
  }

  /** particles from a screen point (or the top of the queue) into a ticket */
  burst(from: { x: number; y: number }, target: HTMLElement, color: string, onLand?: () => void) {
    const n = 160;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(Array.from({ length: n }, () => Math.random())), 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(color) }, uFade: { value: 1 }, uDpr: { value: this.renderer.getPixelRatio() } },
      vertexShader: 'attribute float aSeed; uniform float uDpr; varying float vS; void main(){ vS = aSeed; gl_PointSize = (7.0 + aSeed * 9.0) * uDpr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uFade; varying float vS; void main(){ float d = length(gl_PointCoord - 0.5); float core = smoothstep(0.18, 0.0, d); float a = smoothstep(0.5, 0.0, d) * 0.8 + core; gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.85, 0.4), 0.35 * vS + core * 0.5), a * uFade); }',
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    const f: THREE.Vector2[] = [], c: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 26;
      f.push(new THREE.Vector2(from.x + Math.cos(a) * r, from.y + Math.sin(a) * r));
      c.push(new THREE.Vector2(from.x + (Math.random() - 0.5) * 420, from.y - 80 - Math.random() * 220));
    }
    this.bursts.push({ pts, from: f, ctrl: c, delay: new Float32Array(Array.from({ length: n }, () => Math.random() * 0.35)), target, t: 0, onLand, landed: false });
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = now / 1000;
    const w = innerWidth, h = innerHeight;
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) r.setSize(w, h, false);
    this.cam.right = w; this.cam.bottom = h; this.cam.updateProjectionMatrix();

    for (const f of this.frames.values()) {
      const b = f.el.getBoundingClientRect();
      const pad = 14;
      f.mesh.position.set(b.left + b.width / 2, b.top + b.height / 2, 0);
      f.mesh.scale.set(b.width + pad * 2, -(b.height + pad * 2), 1);
      const u = f.mesh.material.uniforms;
      u.uSize.value.set(b.width + pad * 2, b.height + pad * 2);
      u.uUrg.value += (f.urg - u.uUrg.value) * Math.min(1, dt * 3);
      u.uTime.value = t;
      f.flash = Math.max(0, f.flash - dt * 1.4);
      u.uFlash.value = f.flash;
      if (f.burn > 0) {
        f.burn = Math.min(1.2, f.burn + dt * 0.9);
        u.uBurn.value = f.burn;
        if (f.burn >= 1.2) {
          const done = f.onBurnt;
          f.onBurnt = undefined;
          f.burn = 0;
          u.uBurn.value = 0;
          done?.();
        }
      }
      f.mesh.visible = b.bottom > 0 && b.top < h;
    }

    for (const bu of this.bursts) {
      bu.t += dt;
      const tb = bu.target.getBoundingClientRect();
      const pos = bu.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      let all = true;
      for (let i = 0; i < pos.count; i++) {
        const k = THREE.MathUtils.clamp((bu.t - bu.delay[i]) / 1.25, 0, 1);
        const e = k * k * (3 - 2 * k);
        if (k < 1) all = false;
        const tx = tb.left + ((i * 37) % 100) / 100 * tb.width, ty = tb.top + tb.height * 0.5;
        const a = bu.from[i], c = bu.ctrl[i];
        const x = (1 - e) * (1 - e) * a.x + 2 * (1 - e) * e * c.x + e * e * tx;
        const y = (1 - e) * (1 - e) * a.y + 2 * (1 - e) * e * c.y + e * e * ty;
        pos.setXYZ(i, x, y, 0);
      }
      pos.needsUpdate = true;
      if (all && !bu.landed) { bu.landed = true; this.flash(bu.target); bu.onLand?.(); }
      if (bu.landed) bu.pts.material.uniforms.uFade.value = Math.max(0, bu.pts.material.uniforms.uFade.value - dt * 3);
    }
    this.bursts = this.bursts.filter((bu) => {
      if (bu.landed && bu.pts.material.uniforms.uFade.value <= 0) { this.scene.remove(bu.pts); bu.pts.geometry.dispose(); bu.pts.material.dispose(); return false; }
      return true;
    });

    r.setScissorTest(false);
    r.clear();
    const c = this.clipEl?.isConnected ? this.clipEl.getBoundingClientRect() : null;
    if (c && c.width > 0 && this.bursts.length === 0) {
      r.setScissor(c.left - 16, h - c.bottom - 16, c.width + 32, c.height + 32);
      r.setScissorTest(true);
    }
    r.render(this.scene, this.cam);
    r.setScissorTest(false);
  };

  dispose() { cancelAnimationFrame(this.raf); this.renderer.dispose(); this.renderer.forceContextLoss(); }
}
