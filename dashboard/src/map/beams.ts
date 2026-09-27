import mapboxgl from 'mapbox-gl';
import * as THREE from 'three';
import type { Issue } from '@shared/types';
import { sla } from '@shared/sla';
import { category } from '../lib/format';

// Light beams: a three.js scene drawn inside Mapbox's own WebGL context (a custom layer), so the
// beams sit in the 3D city with the buildings and tilt with the camera. Every open issue rises
// from where it was photographed in its category colour, taller for higher priority; the ring at
// its foot pulses faster as it nears its service target and turns red once it's late. A new
// report or a resident's confirmation sends a shockwave across the street.

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uGlow;
uniform float uTime;
uniform float uNight;
varying vec2 vUv;
void main() {
  float core = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float fall = pow(1.0 - vUv.y, 1.3);
  float shimmer = 0.88 + 0.12 * sin(vUv.y * 38.0 - uTime * 5.0);
  float a = fall * (0.3 + 0.7 * core) * shimmer * uGlow;
  // by night the beams add light; by day they're solid glass so they read on a pale map
  vec3 col = mix(uColor * 0.95, uColor * 1.7, uNight);
  gl_FragColor = vec4(col * mix(1.0, a, uNight), a * mix(0.85, 1.0, uNight));
}`;

const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uSpeed;
uniform float uGlow;
uniform float uShock;
uniform float uNight;
varying vec2 vUv;
void main() {
  float d = distance(vUv, vec2(0.5)) * 2.0;
  float a = 0.0;
  for (int i = 0; i < 2; i++) {
    float ph = fract(uTime * uSpeed + float(i) * 0.5);
    a += smoothstep(0.06, 0.0, abs(d - ph * 0.45)) * (1.0 - ph);
  }
  a += smoothstep(0.1, 0.0, d) * 0.8;
  // shockwave: one wide ring racing outward after a new report or confirmation
  float s = 1.0 - uShock;
  a += smoothstep(0.05, 0.0, abs(d - s)) * uShock * 1.6;
  a *= uGlow * step(d, 1.0);
  gl_FragColor = vec4(uColor * mix(1.0, a, uNight), a * mix(0.75, 1.0, uNight));
}`;

interface Beam {
  group: THREE.Group;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  ring: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  height: number;
  target: number;
  shock: number;
  reports: number;
}

export class BeamsLayer implements mapboxgl.CustomLayerInterface {
  readonly id = 'issue-beams';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private map: mapboxgl.Map | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private beams = new Map<number, Beam>();
  private origin: mapboxgl.MercatorCoordinate;
  private scale: number;
  private transform: THREE.Matrix4;
  private selected: number | null = null;
  private night = 0;
  private visible = true;
  private last = performance.now();
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(center: [number, number]) {
    this.origin = mapboxgl.MercatorCoordinate.fromLngLat(center, 0);
    this.scale = this.origin.meterInMercatorCoordinateUnits();
    // three.js is Y-up in metres; Mapbox's mercator world is Z-up
    this.transform = new THREE.Matrix4()
      .makeTranslation(this.origin.x, this.origin.y, this.origin.z ?? 0)
      .scale(new THREE.Vector3(this.scale, -this.scale, this.scale))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  }

  onAdd(map: mapboxgl.Map, gl: WebGLRenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
  }

  onRemove() {
    this.renderer?.dispose();
    this.renderer = null;
    this.map = null;
  }

  setNight(on: boolean) { this.night = on ? 1 : 0; }
  setVisible(on: boolean) { this.visible = on; this.map?.triggerRepaint(); }
  setSelected(id: number | null) { this.selected = id; }

  /** metres east/north of the layer origin, as three.js x / -z */
  private local(lng: number, lat: number) {
    const m = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], 0);
    return new THREE.Vector3((m.x - this.origin.x) / this.scale, 0, (m.y - this.origin.y) / this.scale);
  }

  setIssues(issues: Issue[], fresh: Set<number>, now = Date.now()) {
    const seen = new Set<number>();
    for (const i of issues) {
      if (i.status === 'resolved') continue;
      seen.add(i.id);
      let b = this.beams.get(i.id);
      if (!b) {
        b = this.make();
        this.beams.set(i.id, b);
        this.scene.add(b.group);
        b.reports = i.reports;
        if (fresh.has(i.id)) b.shock = 1;
      }
      if (i.reports > b.reports) b.shock = 1; // a resident just confirmed it
      b.reports = i.reports;
      b.group.position.copy(this.local(i.lng, i.lat));
      b.target = 55 + (i.priority / 100) * 230 + Math.min(i.reports, 12) * 9;
      const s = sla(i, now);
      const late = s.state === 'breached';
      const color = new THREE.Color(late ? '#e0302b' : category(i.category).color);
      b.beam.material.uniforms.uColor.value.copy(color);
      b.ring.material.uniforms.uColor.value.copy(color);
      b.ring.material.uniforms.uSpeed.value = late ? 1.4 : s.state === 'at_risk' ? 0.9 : 0.35;
      b.group.userData.id = i.id;
    }
    for (const [id, b] of this.beams) {
      if (!seen.has(id)) {
        this.scene.remove(b.group);
        b.beam.geometry.dispose(); b.beam.material.dispose(); b.ring.geometry.dispose(); b.ring.material.dispose();
        this.beams.delete(id);
      }
    }
    this.map?.triggerRepaint();
  }

  private make(): Beam {
    const shared = () => ({ uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uGlow: { value: 1 }, uNight: { value: 0 } });
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(4.5, 4.5, 1, 18, 1, true).translate(0, 0.5, 0),
      new THREE.ShaderMaterial({ uniforms: shared(), vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({ uniforms: { ...shared(), uSpeed: { value: 0.35 }, uShock: { value: 0 } }, vertexShader: BEAM_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false }),
    );
    ring.position.y = 1.5;
    const group = new THREE.Group();
    group.add(beam, ring);
    return { group, beam, ring, height: 0, target: 0, shock: 0, reports: 0 };
  }

  render(_gl: WebGLRenderingContext, matrix: number[]) {
    const r = this.renderer, map = this.map;
    if (!r || !map) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = this.reduced ? 0 : now / 1000;
    const additive = this.night > 0.5;
    for (const [id, b] of this.beams) {
      b.height += (b.target - b.height) * Math.min(1, dt * 2.5);
      b.beam.scale.set(1, Math.max(0.01, b.height), 1);
      b.shock = Math.max(0, b.shock - dt * 0.55);
      const sel = id === this.selected ? 1 : 0;
      const glow = this.visible ? 0.75 + sel * 0.6 : 0;
      for (const m of [b.beam.material, b.ring.material]) {
        m.uniforms.uTime.value = t;
        m.uniforms.uNight.value = this.night;
        m.uniforms.uGlow.value = glow;
        m.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      }
      b.ring.material.uniforms.uShock.value = b.shock;
      b.ring.scale.setScalar(1 + sel * 0.5 + b.shock * 2.5);
    }
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(this.transform);
    r.resetState();
    r.render(this.scene, this.camera);
    if (this.visible && this.beams.size && !document.hidden) map.triggerRepaint();
  }
}
