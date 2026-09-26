import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ApiIssue } from '../data/api';
import { category } from '../data/categories';
import { urgency } from '../data/view';
import type { View } from './backStage';

// Downtown Ottawa as a table of hex tiles. Every open issue raises its tile: height from
// priority and confirmations, colour from the utility-marking code, glow from urgency.
// The Rideau Canal and the Ottawa River are cut into the table, and tiny Mamdani walks to
// whatever the operator selects (or the most urgent open issue) and plants a flag there.

const LAT0 = 45.4125, LNG0 = -75.6975; // table centre, near the Laurier Ave bridge
const M_PER_UNIT = 400;
const R = 0.42; // hex radius in table units (~170 m)
const COLS = 15, ROWS = 19;
const K_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);

export function project(lat: number, lng: number) {
  return new THREE.Vector2(((lng - LNG0) * K_LNG) / M_PER_UNIT, (-(lat - LAT0) * 110_540) / M_PER_UNIT);
}

const RIVERS: Array<{ pts: Array<[number, number]>; width: number }> = [
  { width: 260, pts: [[45.4405, -75.7400], [45.4335, -75.7180], [45.4292, -75.7060], [45.4283, -75.6985], [45.4318, -75.6915], [45.4378, -75.6835], [45.4420, -75.6700]] },
  { width: 95, pts: [[45.4262, -75.6975], [45.4222, -75.6933], [45.4183, -75.6903], [45.4128, -75.6872], [45.4078, -75.6857], [45.4035, -75.6862], [45.3995, -75.6905], [45.3958, -75.6968], [45.3935, -75.7045]] },
  { width: 150, pts: [[45.4400, -75.6745], [45.4230, -75.6690], [45.4060, -75.6660], [45.3900, -75.6700]] },
];

function distToPolyline(p: THREE.Vector2, pts: THREE.Vector2[]) {
  let best = Infinity;
  const ab = new THREE.Vector2(), ap = new THREE.Vector2();
  for (let i = 0; i < pts.length - 1; i++) {
    ab.subVectors(pts[i + 1], pts[i]);
    ap.subVectors(p, pts[i]);
    const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
    best = Math.min(best, ap.sub(ab.multiplyScalar(t)).length());
    ab.subVectors(pts[i + 1], pts[i]);
  }
  return best;
}

const COLUMN_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aUrg;
attribute float aSel;
attribute float aHeight;
varying vec3 vN;
varying vec3 vColor;
varying float vUrg;
varying float vSel;
varying float vY;
varying float vH;
void main() {
  vColor = aColor; vUrg = aUrg; vSel = aSel; vY = position.y; vH = aHeight;
  mat4 m = modelMatrix * instanceMatrix;
  vN = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
}`;

const COLUMN_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vColor;
varying float vUrg;
varying float vSel;
varying float vY;
varying float vH;
void main() {
  vec3 L = normalize(vec3(-0.4, 1.0, 0.55));
  float diff = 0.38 + 0.62 * max(dot(normalize(vN), L), 0.0);
  float top = step(0.985, vY);
  vec3 col = vColor * diff;
  // floor bands up the sides: reads as a stack of confirmations
  float band = step(0.82, fract(vY * vH * 7.0)) * (1.0 - top);
  col *= 1.0 - band * 0.35;
  float pulse = 0.5 + 0.5 * sin(uTime * (1.5 + 6.0 * vUrg));
  col += vColor * top * (0.25 + vUrg * pulse * 0.9);
  col += vColor * (1.0 - vY) * 0.0 + vColor * pow(vY, 6.0) * vUrg * 0.35;
  col = mix(col, vec3(1.0, 0.67, 0.0), vSel * top * 0.7);
  col += vec3(1.0) * vSel * (1.0 - top) * 0.08 * (0.5 + 0.5 * sin(uTime * 4.0));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vW;
void main() {
  float w = sin(vW.x * 5.0 + uTime * 1.4) * sin(vW.z * 6.0 - uTime * 1.1);
  float glint = smoothstep(0.75, 1.0, w);
  vec3 col = mix(vec3(0.35, 0.62, 0.78), vec3(0.84, 0.95, 1.0), 0.5 + 0.5 * w) * 0.55;
  col += glint * vec3(0.5, 0.75, 0.95) * 0.5;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const FLAG_VERT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float k = uv.x;
  p.z += sin(uv.x * 7.0 - uTime * 7.0) * 0.05 * k;
  p.y += sin(uv.x * 5.0 - uTime * 5.0) * 0.015 * k;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FLAG_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv;
void main() {
  float shade = 0.75 + 0.25 * sin(vUv.x * 7.0 - uTime * 7.0);
  vec3 col = uColor * shade;
  float stripe = step(0.42, vUv.y) * step(vUv.y, 0.58);
  col = mix(col, vec3(1.0), stripe * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

interface Cell { col: number; row: number; pos: THREE.Vector2; water: boolean }

export class CityTable implements View {
  clip: HTMLElement | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  private cells: Cell[] = [];
  private columns: THREE.InstancedMesh;
  private columnMat: THREE.ShaderMaterial;
  private waterMat: THREE.ShaderMaterial;
  private flagMat: THREE.ShaderMaterial;
  private colIssues: ApiIssue[][] = [];
  private heights: number[] = [];
  private targets: number[] = [];
  private issues: ApiIssue[] = [];
  private cursor: number | null = null;
  private selected: number | null = null;
  private hovered = -1;
  private mayor = new THREE.Group();
  private mayorParts: Record<string, THREE.Object3D> = {};
  private mayorTarget = new THREE.Vector3();
  private mayorState: 'walk' | 'plant' | 'idle' = 'idle';
  private plantT = 0;
  private flag = new THREE.Group();
  private dust: THREE.Points;
  private dustLife = 0;
  private orbit = 0;
  private focusPt = new THREE.Vector3(0, 0, 0);
  private lookPt = new THREE.Vector3(0, 0, 0);
  private dragX = 0;
  private ray = new THREE.Raycaster();
  onFocus?: (screen: { x: number; y: number } | null) => void;

  constructor(public el: HTMLElement, private onPick: (issueIds: number[]) => void) {
    this.scene.fog = new THREE.Fog(0x021a33, 12, 24);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x1a1a22, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-4, 9, 5);
    this.scene.add(sun);

    // hex cells over the table
    const rivers = RIVERS.map((r) => ({ w: r.width / M_PER_UNIT / 2 + R * 0.35, pts: r.pts.map(([la, ln]) => project(la, ln)) }));
    const dx = Math.sqrt(3) * R, dz = 1.5 * R;
    for (let row = 0; row < ROWS; row++)
      for (let col = 0; col < COLS; col++) {
        const pos = new THREE.Vector2((col - COLS / 2) * dx + (row % 2 ? dx / 2 : 0), (row - ROWS / 2) * dz);
        const water = rivers.some((r) => distToPolyline(pos, r.pts) < r.w);
        this.cells.push({ col, row, pos, water });
      }

    const hex = new THREE.CylinderGeometry(R * 0.93, R * 0.93, 1, 6, 1);
    hex.translate(0, 0.5, 0);

    // base tiles (land) with a little height noise, so the table feels carved, not flat
    const land = this.cells.filter((c) => !c.water);
    const base = new THREE.InstancedMesh(hex, new THREE.MeshLambertMaterial({ color: 0xffffff }), land.length);
    const m4 = new THREE.Matrix4(), col3 = new THREE.Color();
    land.forEach((c, i) => {
      const h = 0.05 + ((Math.sin(c.col * 12.9898 + c.row * 78.233) * 43758.5453) % 1 + 1) % 1 * 0.05;
      m4.compose(new THREE.Vector3(c.pos.x, 0, c.pos.y), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
      base.setMatrixAt(i, m4);
      base.setColorAt(i, col3.setRGB(0.05 + h * 0.6, 0.17 + h * 0.9, 0.30 + h * 1.1, THREE.SRGBColorSpace));
    });
    this.scene.add(base);

    this.waterMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * instanceMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: WATER_FRAG,
    });
    const waterCells = this.cells.filter((c) => c.water);
    const water = new THREE.InstancedMesh(hex, this.waterMat, waterCells.length);
    waterCells.forEach((c, i) => {
      m4.compose(new THREE.Vector3(c.pos.x, 0, c.pos.y), new THREE.Quaternion(), new THREE.Vector3(1, 0.03, 1));
      water.setMatrixAt(i, m4);
    });
    this.scene.add(water);

    // issue columns: one instance per land cell, height 0 until something is reported there
    this.columnMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: COLUMN_VERT, fragmentShader: COLUMN_FRAG });
    const colGeo = hex.clone();
    const n = this.cells.length;
    colGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
    colGeo.setAttribute('aUrg', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
    colGeo.setAttribute('aSel', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
    colGeo.setAttribute('aHeight', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
    this.columns = new THREE.InstancedMesh(colGeo, this.columnMat, n);
    this.columns.frustumCulled = false;
    this.heights = new Array(n).fill(0);
    this.targets = new Array(n).fill(0);
    this.colIssues = Array.from({ length: n }, () => []);
    this.scene.add(this.columns);

    // the flag he plants
    this.flagMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xff6a13) } }, vertexShader: FLAG_VERT, fragmentShader: FLAG_FRAG, side: THREE.DoubleSide });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 6), new THREE.MeshLambertMaterial({ color: 0xffab00 }));
    pole.position.y = 0.31;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18, 16, 4), this.flagMat);
    cloth.position.set(0.15, 0.52, 0);
    this.flag.add(pole, cloth);
    this.flag.visible = false;
    this.scene.add(this.flag);

    // dust puff when the flag goes in
    const dustGeo = new THREE.BufferGeometry();
    const dp = new Float32Array(60 * 3);
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xd9ccb0, size: 0.05, transparent: true, opacity: 0 }));
    this.scene.add(this.dust);

    // blob shadow + the mayor himself
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.2, 24),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'varying vec2 vUv; void main(){ float d = distance(vUv, vec2(0.5)); gl_FragColor = vec4(0.0,0.0,0.0, smoothstep(0.5, 0.0, d) * 0.55); }',
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    this.mayor.add(shadow);
    // his own pool of streetlight, so he reads against the dark table
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 40),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform float uTime; varying vec2 vUv; void main(){ float d = distance(vUv, vec2(0.5)) * 2.0; float a = smoothstep(1.0, 0.0, d) * (0.34 + 0.04 * sin(uTime * 2.0)); gl_FragColor = vec4(vec3(1.0, 0.67, 0.0) * a, a); }',
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.11;
    this.mayor.add(pool);
    this.mayor.userData.pool = pool;
    const key = new THREE.PointLight(0xffc04d, 2.4, 2.4, 1.5);
    key.position.set(0.25, 0.9, 0.35);
    this.mayor.add(key);
    this.scene.add(this.mayor);
    this.loadMayor();

    this.bindPointer();
  }

  private loadMayor() {
    new GLTFLoader().load('/models/mamdani-suit.glb', (g) => {
      const model = g.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const s = 0.95 / size.y;
      model.scale.setScalar(s);
      model.position.y = -box.min.y * s;
      model.traverse((o) => {
        if (o.name) this.mayorParts[o.name] = o;
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.frustumCulled = false;
      });
      this.mayor.add(model);
    }, undefined, () => {
      // no model: a simple stand-in so the table still has its character
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.28, 4, 10), new THREE.MeshLambertMaterial({ color: 0x1f2a44 }));
      body.position.y = 0.24;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshLambertMaterial({ color: 0xc58c5c }));
      head.position.y = 0.5;
      this.mayor.add(body, head);
    });
  }

  private bindPointer() {
    let down: { x: number; y: number; orbit: number } | null = null;
    this.el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, orbit: this.dragX }; });
    addEventListener('pointerup', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) this.pick(e.clientX, e.clientY, true);
      down = null;
    });
    this.el.addEventListener('pointermove', (e) => {
      if (down) this.dragX = down.orbit + (e.clientX - down.x) * 0.005;
      else this.pick(e.clientX, e.clientY, false);
    });
    this.el.addEventListener('pointerleave', () => { this.hovered = -1; this.el.style.cursor = ''; });
  }

  private pick(cx: number, cy: number, click: boolean) {
    const b = this.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - b.left) / b.width) * 2 - 1, -((cy - b.top) / b.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = this.ray.intersectObject(this.columns, false).find((h) => h.instanceId !== undefined && this.colIssues[h.instanceId!].length);
    this.hovered = hit?.instanceId ?? -1;
    this.el.style.cursor = this.hovered >= 0 ? 'pointer' : 'grab';
    if (click) this.onPick(this.hovered >= 0 ? this.colIssues[this.hovered].map((i) => i.id) : []);
  }

  private cellFor(lat: number, lng: number) {
    const p = project(lat, lng);
    let best = -1, bd = Infinity;
    this.cells.forEach((c, i) => {
      if (c.water) return;
      const d = c.pos.distanceToSquared(p);
      if (d < bd) { bd = d; best = i; }
    });
    return bd < (R * 2.5) ** 2 ? best : -1;
  }

  setIssues(issues: ApiIssue[]) {
    this.issues = issues;
    if (issues.length) {
      const c = issues.reduce((a, i) => a.add(project(i.lat, i.lng)), new THREE.Vector2()).divideScalar(issues.length);
      this.focusPt.set(c.x, 0, c.y);
    }
    this.rebuild();
  }
  setCursor(ms: number | null) { this.cursor = ms; this.rebuild(); }
  setSelected(id: number | null) { this.selected = id; this.rebuild(true); }

  private rebuild(retarget = false) {
    const now = this.cursor ?? Date.now();
    this.colIssues.forEach((l) => (l.length = 0));
    for (const i of this.issues) {
      if (i.firstReportedAt > now) continue;
      const c = this.cellFor(i.lat, i.lng);
      if (c >= 0) this.colIssues[c].push(i);
    }
    const aColor = this.columns.geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    const aUrg = this.columns.geometry.getAttribute('aUrg') as THREE.InstancedBufferAttribute;
    const aSel = this.columns.geometry.getAttribute('aSel') as THREE.InstancedBufferAttribute;
    const col = new THREE.Color();
    this.colIssues.forEach((list, idx) => {
      const open = list.filter((i) => i.status !== 'resolved' && !(this.cursor && i.resolvedAt && i.resolvedAt <= now));
      const lead = [...open].sort((a, b) => b.priority - a.priority)[0];
      if (lead) {
        const reports = open.reduce((s, i) => s + i.reports, 0);
        this.targets[idx] = 0.25 + lead.priority / 100 * 1.4 + Math.min(reports, 12) * 0.08;
        col.set(category(lead.category).color);
        aUrg.setX(idx, urgency(lead, now));
      } else if (list.length) {
        this.targets[idx] = 0.12;
        col.set('#d6f3ff');
        aUrg.setX(idx, 0);
      } else {
        this.targets[idx] = 0;
        col.setRGB(0, 0, 0);
        aUrg.setX(idx, 0);
      }
      aColor.setXYZ(idx, col.r, col.g, col.b);
      aSel.setX(idx, list.some((i) => i.id === this.selected) ? 1 : 0);
    });
    aColor.needsUpdate = aUrg.needsUpdate = aSel.needsUpdate = true;

    // where should he stand?
    let goal = this.selected !== null ? this.colIssues.findIndex((l) => l.some((i) => i.id === this.selected)) : -1;
    if (goal < 0) {
      let bestP = -1;
      this.colIssues.forEach((l, idx) => l.forEach((i) => { if (i.status !== 'resolved' && i.priority > bestP) { bestP = i.priority; goal = idx; } }));
    }
    if (goal >= 0 && this.selected !== null) this.focusPt.set(this.cells[goal].pos.x, 0, this.cells[goal].pos.y);
    if (goal >= 0) {
      const c = this.cells[goal].pos;
      const next = new THREE.Vector3(c.x + R * 0.95, 0.1, c.y + R * 0.6);
      if (retarget || next.distanceTo(this.mayorTarget) > 0.01) {
        this.mayorTarget.copy(next);
        this.mayorState = 'walk';
        this.flagMat.uniforms.uColor.value.set(category((this.colIssues[goal].find((i) => i.id === this.selected) ?? this.colIssues[goal][0]).category).color);
        this.flag.userData.cell = goal;
      }
    }
  }

  render(r: THREE.WebGLRenderer, t: number, dt: number, w: number, h: number) {
    this.camera.aspect = w / h;
    this.orbit += dt * 0.03;
    const a = Math.sin(this.orbit) * 0.18 + this.dragX;
    const dist = 8.2;
    this.lookPt.lerp(this.focusPt, Math.min(1, dt * 2));
    this.camera.position.set(this.lookPt.x + Math.sin(a) * dist, 6.2, this.lookPt.z + Math.cos(a) * dist);
    this.camera.lookAt(this.lookPt.x, 0.3, this.lookPt.z - 0.4);
    this.camera.updateProjectionMatrix();
    this.columnMat.uniforms.uTime.value = t;
    this.waterMat.uniforms.uTime.value = t;
    this.flagMat.uniforms.uTime.value = t;
    const pool = this.mayor.userData.pool as THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial> | undefined;
    if (pool) pool.material.uniforms.uTime.value = t;

    // columns grow towards their targets
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    const aH = this.columns.geometry.getAttribute('aHeight') as THREE.InstancedBufferAttribute;
    for (let i = 0; i < this.cells.length; i++) {
      const hover = i === this.hovered ? 0.12 : 0;
      this.heights[i] += (this.targets[i] + (this.targets[i] ? hover : 0) - this.heights[i]) * Math.min(1, dt * 4);
      const hh = Math.max(0.0001, this.heights[i]);
      const c = this.cells[i].pos;
      m4.compose(new THREE.Vector3(c.x, 0.1, c.y), q, new THREE.Vector3(0.82, hh, 0.82));
      this.columns.setMatrixAt(i, m4);
      aH.setX(i, hh);
    }
    this.columns.instanceMatrix.needsUpdate = true;
    aH.needsUpdate = true;

    this.animateMayor(t, dt);
    r.render(this.scene, this.camera);

    if (this.onFocus) {
      const cell = this.flag.userData.cell as number | undefined;
      if (cell !== undefined && this.selected !== null) {
        const p = new THREE.Vector3(this.cells[cell].pos.x, 0.1 + this.heights[cell], this.cells[cell].pos.y).project(this.camera);
        this.onFocus({ x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h });
      } else this.onFocus(null);
    }
  }

  private animateMayor(t: number, dt: number) {
    const m = this.mayor;
    const to = new THREE.Vector3().subVectors(this.mayorTarget, m.position);
    to.y = 0;
    const d = to.length();
    const arm = (name: string, v: number) => { const p = this.mayorParts[name]; if (p) p.rotation.x = v; };
    if (this.mayorState === 'walk') {
      this.flag.visible = false;
      if (d > 0.03) {
        const step = Math.min(d, dt * 1.6);
        m.position.addScaledVector(to.normalize(), step);
        m.rotation.y = THREE.MathUtils.lerp(m.rotation.y, Math.atan2(to.x, to.z), Math.min(1, dt * 8));
        const phase = t * 11;
        m.position.y = this.mayorTarget.y + Math.abs(Math.sin(phase)) * 0.04;
        arm('arm-left', Math.sin(phase) * 0.7);
        arm('arm-right', -Math.sin(phase) * 0.7);
      } else {
        this.mayorState = 'plant';
        this.plantT = 0;
      }
    } else if (this.mayorState === 'plant') {
      this.plantT += dt;
      const k = Math.min(1, this.plantT / 0.6);
      arm('arm-right', -2.4 * Math.sin(k * Math.PI));
      m.position.y = this.mayorTarget.y;
      if (this.plantT > 0.35 && !this.flag.visible) {
        const cell = this.cells[this.flag.userData.cell as number].pos;
        this.flag.position.set(cell.x, 0.1 + this.targets[this.flag.userData.cell as number], cell.y);
        this.flag.visible = true;
        this.flag.scale.setScalar(0.01);
        this.puff(this.flag.position);
      }
      if (this.plantT > 0.8) this.mayorState = 'idle';
    } else {
      m.position.y = this.mayorTarget.y + Math.sin(t * 2) * 0.006;
      arm('arm-left', Math.sin(t * 1.3) * 0.06);
      arm('arm-right', 0.1 + Math.sin(t * 1.3 + 1) * 0.06);
      m.rotation.y = THREE.MathUtils.lerp(m.rotation.y, Math.atan2(this.camera.position.x - m.position.x, this.camera.position.z - m.position.z), Math.min(1, dt * 2));
    }
    if (this.flag.visible && this.flag.scale.x < 1) this.flag.scale.setScalar(Math.min(1, this.flag.scale.x + dt * 5));
    if (this.flag.visible) {
      const cell = this.flag.userData.cell as number;
      this.flag.position.y = 0.1 + this.heights[cell];
    }

    // dust
    const mat = this.dust.material as THREE.PointsMaterial;
    if (this.dustLife > 0) {
      this.dustLife -= dt;
      const pos = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
      const v = this.dust.userData.v as Float32Array;
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i, pos.getX(i) + v[i * 3] * dt, pos.getY(i) + v[i * 3 + 1] * dt, pos.getZ(i) + v[i * 3 + 2] * dt);
        v[i * 3 + 1] -= dt * 1.5;
      }
      pos.needsUpdate = true;
      mat.opacity = Math.max(0, this.dustLife / 0.9) * 0.8;
    } else mat.opacity = 0;
  }

  private puff(at: THREE.Vector3) {
    const pos = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    const v = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const a = (i / pos.count) * Math.PI * 2;
      pos.setXYZ(i, at.x, at.y + 0.02, at.z);
      v[i * 3] = Math.cos(a) * (0.4 + Math.random() * 0.5);
      v[i * 3 + 1] = 0.3 + Math.random() * 0.6;
      v[i * 3 + 2] = Math.sin(a) * (0.4 + Math.random() * 0.5);
    }
    pos.needsUpdate = true;
    this.dust.userData.v = v;
    this.dustLife = 0.9;
  }
}
