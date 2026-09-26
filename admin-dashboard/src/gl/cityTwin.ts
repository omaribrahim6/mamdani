import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ApiIssue } from '../data/api';
import { category } from '../data/categories';
import { urgency } from '../data/view';
import twin from '../fixtures/twin.json';
import { loadMascot } from '../mayor/load';
import { createMayor } from '../mayor/models';
import type { MayorRig } from '../mayor/build';
import type { View } from './backStage';

// A digital twin of downtown Ottawa: the real street network, water and building footprints
// from OpenStreetMap (scripts/build-twin.mjs), drawn as a survey-grade night map. Every open
// report is a beam of light rising from where it was photographed; a sweep from City Hall
// passes over the city and each beam flares as it's swept. Mamdani walks to the selection.

const LAT0 = 45.4125, LNG0 = -75.6975, M = 100;
const K_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180), K_LAT = 110_540;
export const toXZ = (lat: number, lng: number) => new THREE.Vector2(((lng - LNG0) * K_LNG) / M, (-(lat - LAT0) * K_LAT) / M);
const CITY_HALL = toXZ(45.4209, -75.6903);

interface Twin {
  roads: Array<{ c: number; p: number[] }>;
  water: number[][];
  waterLines: Array<{ w: number; p: number[] }>;
  buildings: Array<{ h: number; p: number[] }>;
}
const T = twin as unknown as Twin;

const GROUND_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uHall;
uniform vec2 uFocus;
varying vec3 vW;
void main() {
  vec2 p = vW.xz;
  // survey grid: 100 m minor, 500 m major
  vec2 g1 = abs(fract(p) - 0.5), g5 = abs(fract(p / 5.0) - 0.5) * 5.0;
  float fw = fwidth(p.x) + fwidth(p.y);
  float minor = 1.0 - smoothstep(0.0, fw * 1.2, min(0.5 - g1.x, 0.5 - g1.y));
  float major = 1.0 - smoothstep(0.0, fw * 1.5, min(2.5 - g5.x, 2.5 - g5.y));
  vec3 col = vec3(0.05, 0.085, 0.13);
  col += vec3(0.45, 0.6, 0.8) * (minor * 0.035 + major * 0.07);
  // radar sweep from City Hall
  vec2 d = p - uHall;
  float ang = atan(d.y, d.x);
  float sweep = mod(uTime * 0.55, 6.2831853) - 3.14159265;
  float delta = mod(sweep - ang + 6.2831853, 6.2831853);
  float trail = exp(-delta * 3.2) * smoothstep(38.0, 4.0, length(d));
  col += vec3(0.3, 0.55, 0.9) * trail * 0.16;
  // range rings every 1 km
  float r = length(d);
  float toRing = (0.5 - abs(fract(r / 10.0) - 0.5)) * 10.0;
  float ring = 1.0 - smoothstep(0.0, fw * 1.5, toRing);
  col += vec3(0.5, 0.65, 0.85) * ring * 0.05;
  float fade = smoothstep(46.0, 20.0, distance(p, uFocus));
  gl_FragColor = vec4(col, fade);
  #include <colorspace_fragment>
}`;

const ROAD_VERT = /* glsl */ `
attribute float aClass;
attribute float aDist;
varying float vClass;
varying float vDist;
varying vec3 vW;
void main() {
  vClass = aClass; vDist = aDist;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const ROAD_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uFocus;
varying float vClass;
varying float vDist;
varying vec3 vW;
void main() {
  float a = vClass < 0.5 ? 0.85 : vClass < 1.5 ? 0.7 : vClass < 2.5 ? 0.42 : vClass < 3.5 ? 0.22 : 0.14;
  vec3 col = mix(vec3(0.55, 0.72, 0.92), vec3(0.95, 0.97, 1.0), step(vClass, 1.5) * 0.5);
  // traffic flowing along the arterials
  float flow = step(vClass, 1.5) * smoothstep(0.82, 1.0, fract(vDist * 0.35 - uTime * 0.45));
  col = mix(col, vec3(1.0, 0.92, 0.7), flow);
  a = max(a, flow);
  a *= smoothstep(46.0, 18.0, distance(vW.xz, uFocus));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uFocus;
varying vec3 vW;
void main() {
  float w = sin(vW.x * 1.7 + uTime * 0.8) * sin(vW.z * 2.1 - uTime * 0.6);
  vec3 col = mix(vec3(0.035, 0.12, 0.2), vec3(0.06, 0.2, 0.3), 0.5 + 0.5 * w);
  float a = 0.95 * smoothstep(50.0, 20.0, distance(vW.xz, uFocus));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

const BUILDING_VERT = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
varying float vH;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vH = position.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const BUILDING_FRAG = /* glsl */ `
uniform vec2 uFocus;
uniform float uTime;
varying vec3 vW;
varying vec3 vN;
varying float vH;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 L = normalize(vec3(-0.4, 0.9, 0.3));
  float side = 1.0 - abs(vN.y);
  float lit = 0.55 + 0.45 * max(dot(vN, L), 0.0);
  vec3 col = vec3(0.09, 0.14, 0.21) * lit;
  // office windows: floors every 3.4 m, a few lit
  vec2 cell = vec2(floor((vW.x + vW.z) * 12.0), floor(vH * 100.0 / 3.4));
  float win = step(0.5, fract((vW.x + vW.z) * 12.0)) * step(0.35, fract(vH * 100.0 / 3.4));
  float on = step(0.78, hash(cell + floor(uTime * 0.02)));
  col += vec3(1.0, 0.86, 0.6) * win * on * side * 0.35;
  // roof edge catch-light
  col += vec3(0.6, 0.75, 0.95) * (1.0 - side) * 0.08;
  float a = smoothstep(40.0, 16.0, distance(vW.xz, uFocus));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uGlow;
uniform float uTime;
varying vec2 vUv;
void main() {
  float up = vUv.y;
  float core = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float a = pow(1.0 - up, 1.4) * (0.35 + 0.65 * core) * uGlow;
  a *= 0.85 + 0.15 * sin(up * 40.0 - uTime * 6.0);
  gl_FragColor = vec4(uColor * a * 1.6, a);
}`;
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uUrg;
uniform float uGlow;
varying vec2 vUv;
void main() {
  float d = distance(vUv, vec2(0.5)) * 2.0;
  float a = 0.0;
  for (int i = 0; i < 2; i++) {
    float ph = fract(uTime * (0.35 + uUrg * 0.8) + float(i) * 0.5);
    a += smoothstep(0.05, 0.0, abs(d - ph)) * (1.0 - ph);
  }
  a += smoothstep(0.14, 0.0, d) * 0.9;
  a *= uGlow * step(d, 1.0);
  gl_FragColor = vec4(uColor * a, a);
}`;
const PASS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
const WORLD_VERT = 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';

interface Beacon {
  issue: ApiIssue;
  group: THREE.Group;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  ring: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  hit: THREE.Mesh;
  height: number;
  shown: number;
  flare: number;
  angle: number;
}

export class CityTwin implements View {
  clip: HTMLElement | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  private uniforms = { uTime: { value: 0 }, uFocus: { value: new THREE.Vector2() }, uHall: { value: CITY_HALL.clone() } };
  private beacons = new Map<number, Beacon>();

  private cursor: number | null = null;
  private selected: number | null = null;
  private hovered: number | null = null;
  private focus = new THREE.Vector3();
  private look = new THREE.Vector3();
  private yaw = -0.35;
  private pitch = 0.62;
  private radius = 30;
  private autoSpin = true;
  private ray = new THREE.Raycaster();
  private rig: MayorRig | null = null;
  private mascot = new THREE.Group();
  private mascotTarget = new THREE.Vector3(CITY_HALL.x + 1.2, 0, CITY_HALL.y + 1.2);
  private walkPhase = 0;
  private wave = 0;
  onFocus?: (p: { x: number; y: number } | null) => void;
  onHover?: (issue: ApiIssue | null, p: { x: number; y: number } | null) => void;

  constructor(public el: HTMLElement, private onPick: (ids: number[]) => void) {
    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x0b1320, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-20, 40, 25);
    this.scene.add(sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: WORLD_VERT, fragmentShader: GROUND_FRAG, transparent: true, depthWrite: false }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    this.buildWater();
    this.buildRoads();
    this.buildBuildings();

    this.scene.add(this.mascot);
    void loadMascot().then(() => {
      const rig = createMayor('suit');
      rig.root.scale.setScalar(1.25);
      this.rig = rig;
      this.mascot.add(rig.root);
    });
    const halo = new THREE.Mesh(new THREE.CircleGeometry(1.6, 40), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.uniforms,
      vertexShader: PASS_VERT,
      fragmentShader: 'uniform float uTime; varying vec2 vUv; void main(){ float d = distance(vUv, vec2(0.5)) * 2.0; float a = smoothstep(1.0, 0.0, d) * 0.28; gl_FragColor = vec4(vec3(0.75, 0.85, 1.0) * a, a); }',
    }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.03;
    this.mascot.add(halo);
    const key = new THREE.PointLight(0xdfe9ff, 18, 8, 1.6);
    key.position.set(1.2, 2.6, 1.6);
    this.mascot.add(key);
    this.mascot.position.copy(this.mascotTarget);

    this.bindPointer();
  }

  private buildRoads() {
    const pos: number[] = [], cls: number[] = [], dist: number[] = [];
    for (const r of T.roads) {
      let d = 0;
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const [x0, z0, x1, z1] = [r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]];
        pos.push(x0, 0.03, z0, x1, 0.03, z1);
        const seg = Math.hypot(x1 - x0, z1 - z0);
        dist.push(d, d + seg);
        d += seg;
        cls.push(r.c, r.c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aClass', new THREE.Float32BufferAttribute(cls, 1));
    g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
    const lines = new THREE.LineSegments(g, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: ROAD_VERT, fragmentShader: ROAD_FRAG, transparent: true, depthWrite: false }));
    this.scene.add(lines);
  }

  private buildWater() {
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: WORLD_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false });
    const geos: THREE.BufferGeometry[] = [];
    for (const poly of T.water) {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i + 1 < poly.length; i += 2) pts.push(new THREE.Vector2(poly[i], -poly[i + 1]));
      try { geos.push(new THREE.ShapeGeometry(new THREE.Shape(pts))); } catch { /* degenerate ring */ }
    }
    if (geos.length) {
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.012;
      this.scene.add(m);
    }
    const pos: number[] = [];
    for (const l of T.waterLines) for (let i = 0; i + 3 < l.p.length; i += 2) pos.push(l.p[i], 0.02, l.p[i + 1], l.p[i + 2], 0.02, l.p[i + 3]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x4fa3c7, transparent: true, opacity: 0.5 })));
  }

  // 13k footprints take about a second to extrude, so the city is built in batches across
  // frames: nothing blocks, and each block of buildings rises out of the ground as it lands.
  private bldQueue = 0;
  private bldMat: THREE.ShaderMaterial | null = null;
  private rising: THREE.Mesh[] = [];
  private buildBuildings() {
    if (!T.buildings?.length) return;
    this.bldMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: BUILDING_VERT, fragmentShader: BUILDING_FRAG, transparent: true });
  }
  private stepBuildings(dt: number) {
    for (const m of this.rising) m.scale.y = Math.min(1, m.scale.y + dt * 1.6);
    this.rising = this.rising.filter((m) => m.scale.y < 1);
    if (!this.bldMat || this.bldQueue >= T.buildings.length) return;
    const t0 = performance.now();
    const geos: THREE.BufferGeometry[] = [];
    while (this.bldQueue < T.buildings.length && performance.now() - t0 < 9) {
      const b = T.buildings[this.bldQueue++];
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i + 1 < b.p.length; i += 2) pts.push(new THREE.Vector2(b.p[i], -b.p[i + 1]));
      try {
        const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: b.h, bevelEnabled: false, curveSegments: 1 });
        g.deleteAttribute('uv');
        geos.push(g);
      } catch { /* bad footprint */ }
    }
    if (!geos.length) return;
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    merged.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(merged, this.bldMat);
    mesh.scale.y = 0.001;
    this.scene.add(mesh);
    this.rising.push(mesh);
  }

  private bindPointer() {
    let down: { x: number; y: number; yaw: number; pitch: number } | null = null;
    this.el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch }; this.autoSpin = false; });
    addEventListener('pointerup', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const hit = this.hit(e.clientX, e.clientY);
        this.onPick(hit ? [hit.issue.id] : []);
      }
      down = null;
    });
    this.el.addEventListener('pointermove', (e) => {
      if (down) {
        this.yaw = down.yaw - (e.clientX - down.x) * 0.006;
        this.pitch = THREE.MathUtils.clamp(down.pitch + (e.clientY - down.y) * 0.004, 0.25, 1.3);
        return;
      }
      const hit = this.hit(e.clientX, e.clientY);
      this.hovered = hit?.issue.id ?? null;
      this.el.style.cursor = hit ? 'pointer' : 'grab';
      const b = this.el.getBoundingClientRect();
      this.onHover?.(hit?.issue ?? null, hit ? { x: e.clientX - b.left, y: e.clientY - b.top } : null);
    });
    this.el.addEventListener('pointerleave', () => { this.hovered = null; this.onHover?.(null, null); });
    this.el.addEventListener('wheel', (e) => { e.preventDefault(); this.radius = THREE.MathUtils.clamp(this.radius * (1 + e.deltaY * 0.001), 9, 60); }, { passive: false });
  }

  private hit(cx: number, cy: number) {
    const b = this.el.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((cx - b.left) / b.width) * 2 - 1, -((cy - b.top) / b.height) * 2 + 1), this.camera);
    const hits = this.ray.intersectObjects([...this.beacons.values()].filter((x) => x.group.visible).map((x) => x.hit), false);
    const id = hits[0]?.object.userData.id as number | undefined;
    return id !== undefined ? this.beacons.get(id) ?? null : null;
  }

  setIssues(issues: ApiIssue[]) {

    for (const i of issues) if (!this.beacons.has(i.id)) this.beacons.set(i.id, this.makeBeacon(i));
    for (const [id, b] of this.beacons) if (!issues.some((i) => i.id === id)) { this.scene.remove(b.group); this.beacons.delete(id); }
    for (const i of issues) this.beacons.get(i.id)!.issue = i;
    if (this.selected === null && issues.length) {
      const c = issues.reduce((a, i) => a.add(toXZ(i.lat, i.lng)), new THREE.Vector2()).divideScalar(issues.length);
      this.focus.set(c.x, 0, c.y);
    }
  }
  setCursor(ms: number | null) { this.cursor = ms; }
  setSelected(id: number | null) {
    this.selected = id;
    const b = id !== null ? this.beacons.get(id) : null;
    if (b) {
      this.focus.set(b.group.position.x, 0, b.group.position.z);
      this.mascotTarget.set(b.group.position.x + 1.3, 0, b.group.position.z + 1.1);
      this.autoSpin = false;
    }
  }

  private makeBeacon(issue: ApiIssue): Beacon {
    const p = toXZ(issue.lat, issue.lng);
    const group = new THREE.Group();
    group.position.set(p.x, 0, p.y);
    const color = new THREE.Color(category(issue.category).color);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 1, 16, 1, true).translate(0, 0.5, 0),
      new THREE.ShaderMaterial({ uniforms: { uColor: { value: color }, uGlow: { value: 1 }, uTime: this.uniforms.uTime }, vertexShader: PASS_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.ShaderMaterial({ uniforms: { uColor: { value: color }, uTime: this.uniforms.uTime, uUrg: { value: 0 }, uGlow: { value: 1 } }, vertexShader: PASS_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1, 8).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData.id = issue.id;
    group.add(beam, ring, hit);
    this.scene.add(group);
    const d = p.clone().sub(CITY_HALL);
    return { issue, group, beam, ring, hit, height: 0, shown: 0, flare: 0, angle: Math.atan2(d.y, d.x) };
  }

  render(r: THREE.WebGLRenderer, t: number, dt: number, w: number, h: number) {
    this.uniforms.uTime.value = t;
    if (this.autoSpin) this.yaw += dt * 0.025;
    this.look.lerp(this.focus, Math.min(1, dt * 2.2));
    this.uniforms.uFocus.value.set(this.look.x, this.look.z);
    const rad = this.radius;
    this.camera.position.set(this.look.x + Math.sin(this.yaw) * Math.cos(this.pitch) * rad, Math.sin(this.pitch) * rad, this.look.z + Math.cos(this.yaw) * Math.cos(this.pitch) * rad);
    this.camera.lookAt(this.look.x, 0.8, this.look.z);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    const now = this.cursor ?? Date.now();
    const sweep = ((t * 0.55) % (Math.PI * 2)) - Math.PI;
    for (const b of this.beacons.values()) {
      const i = b.issue;
      const exists = i.firstReportedAt <= now;
      const open = exists && i.status !== 'resolved' && !(this.cursor && i.resolvedAt && i.resolvedAt <= now);
      const target = !exists ? 0 : open ? 1.6 + (i.priority / 100) * 7 + Math.min(i.reports, 12) * 0.25 : 0.5;
      b.height += (target - b.height) * Math.min(1, dt * 3);
      b.shown += ((exists ? 1 : 0) - b.shown) * Math.min(1, dt * 4);
      b.group.visible = b.shown > 0.02;
      b.beam.scale.set(1, Math.max(0.001, b.height), 1);
      const delta = (((sweep - b.angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (delta < dt * 0.6 + 0.001) b.flare = 1;
      b.flare = Math.max(0, b.flare - dt * 1.3);
      const sel = i.id === this.selected ? 1 : 0, hov = i.id === this.hovered ? 1 : 0;
      const color = open ? category(i.category).color : '#6fd0a0';
      b.beam.material.uniforms.uColor.value.set(color);
      b.ring.material.uniforms.uColor.value.set(color);
      b.beam.material.uniforms.uGlow.value = b.shown * (0.55 + b.flare * 0.6 + sel * 0.6 + hov * 0.35);
      b.ring.material.uniforms.uGlow.value = b.shown * (open ? 0.7 + sel * 0.5 + b.flare * 0.4 : 0.35);
      b.ring.material.uniforms.uUrg.value = open ? urgency(i, now) : 0;
      b.ring.scale.setScalar(1 + sel * 0.6);
      b.hit.scale.set(1, Math.max(1, b.height), 1);
    }

    this.stepBuildings(dt);
    this.animateMascot(t, dt);
    r.render(this.scene, this.camera);

    if (this.onFocus) {
      const b = this.selected !== null ? this.beacons.get(this.selected) : null;
      if (b && b.group.visible) {
        const p = new THREE.Vector3(b.group.position.x, b.height, b.group.position.z).project(this.camera);
        this.onFocus({ x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h });
      } else this.onFocus(null);
    }
  }

  private animateMascot(t: number, dt: number) {
    const m = this.mascot;
    const to = new THREE.Vector3().subVectors(this.mascotTarget, m.position);
    to.y = 0;
    const d = to.length();
    const rig = this.rig;
    if (d > 0.05) {
      m.position.addScaledVector(to.normalize(), Math.min(d, dt * 7));
      m.rotation.y = THREE.MathUtils.lerp(m.rotation.y, Math.atan2(to.x, to.z), Math.min(1, dt * 6));
      this.walkPhase += dt * 9;
      this.wave = 1;
      if (rig) {
        const s = Math.sin(this.walkPhase);
        rig.legL.rotation.x = s * 0.55; rig.legR.rotation.x = -s * 0.55;
        rig.armL.rotation.x = -s * 0.5; rig.armR.rotation.x = s * 0.5;
        rig.body.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.035;
      }
    } else if (rig) {
      rig.legL.rotation.x *= 0.8; rig.legR.rotation.x *= 0.8; rig.armL.rotation.x *= 0.85;
      // arrived: a short wave towards the operator, then rest
      this.wave = Math.max(0, this.wave - dt * 0.6);
      const k = this.wave;
      rig.armR.rotation.x = -2.3 * Math.sin(Math.min(1, k * 1.5) * Math.PI * 0.5) * (k > 0 ? 1 : 0);
      rig.armR.rotation.z = k > 0 ? -0.25 + Math.sin(t * 10) * 0.25 * k : rig.armR.rotation.z * 0.9;
      const face = Math.atan2(this.camera.position.x - m.position.x, this.camera.position.z - m.position.z);
      m.rotation.y = THREE.MathUtils.lerp(m.rotation.y, face, Math.min(1, dt * 2.5));
      rig.head.rotation.y = Math.sin(t * 0.7) * 0.15;
    }
    rig?.update?.();
  }
}
