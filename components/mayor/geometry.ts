import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Small, texture-free modelling helpers, shared by WebGL and Expo GL. */
export type Point = [number, number, number];
export type Ring = [y: number, width: number, depth: number, z?: number];

const materials = new Map<number, THREE.MeshStandardMaterial>();

export function mesh(geometry: THREE.BufferGeometry, color: number, variation = 0.025, roughness = 0.86) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  const positions = g.attributes.position;
  const clean: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < positions.count; i += 3) {
    a.fromBufferAttribute(positions, i);
    b.fromBufferAttribute(positions, i + 1).sub(a);
    c.fromBufferAttribute(positions, i + 2).sub(a);
    if (b.cross(c).lengthSq() < 1e-20) continue;
    for (let j = 0; j < 3; j++) clean.push(positions.getX(i + j), positions.getY(i + j), positions.getZ(i + j));
  }
  if (clean.length !== positions.count * 3) {
    g.dispose();
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(clean, 3));
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const base = new THREE.Color(color);
  const colors: number[] = [];
  for (let i = 0; i < g.attributes.position.count / 3; i++) {
    // A repeatable, very restrained change in pigment between sculpted facets.
    const shade = 1 + Math.sin(i * 127.1 + 31.7) * variation;
    for (let j = 0; j < 3; j++) colors.push(base.r * shade, base.g * shade, base.b * shade);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (!materials.has(roughness)) materials.set(roughness, new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, flatShading: true, roughness, metalness: 0,
  }));
  const result = new THREE.Mesh(g, materials.get(roughness)!);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

export function triangles(points: Point[], faces: number[][]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  g.setIndex(faces.flat());
  return g;
}

/** A closed, bevelled silhouette. Points describe its visible (+Z) face. */
export function panel(points: Point[], color: number, thickness = 0.005, variation = 0.02) {
  const contour = points.map(([x, y]) => new THREE.Vector2(x, y));
  if (THREE.ShapeUtils.isClockWise(contour)) {
    points = [...points].reverse();
    contour.reverse();
  }
  const n = points.length;
  const all: Point[] = [...points, ...points.map(([x, y, z]): Point => [x, y, z - thickness])];
  const front = THREE.ShapeUtils.triangulateShape(contour, []);
  const faces = [...front, ...front.map(([a, b, c]) => [c + n, b + n, a + n])];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, i + n, j], [j, i + n, j + n]);
  }
  return mesh(triangles(all, faces), color, variation);
}

/** Closed faceted loft. A superellipse gives cloth flat fronts and bevelled sides. */
export function profile(rings: Ring[], color: number, segments = 12, exponent = 1, variation = 0.025) {
  const points: Point[] = [];
  for (const [y, width, depth, z = 0] of rings) {
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2;
      const sx = Math.sin(a), cz = Math.cos(a);
      points.push([Math.sign(sx) * Math.abs(sx) ** exponent * width, y, Math.sign(cz) * Math.abs(cz) ** exponent * depth + z]);
    }
  }
  const faces: number[][] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < segments; i++) {
      const a = r * segments + i, b = r * segments + (i + 1) % segments;
      const c = a + segments, d = b + segments;
      if ((r + i) % 2) faces.push([a, b, c], [b, d, c]);
      else faces.push([a, b, d], [a, d, c]);
    }
  }
  for (const end of [0, rings.length - 1]) {
    const [y, , , z = 0] = rings[end];
    const center = points.push([0, y, z]) - 1;
    for (let i = 0; i < segments; i++) {
      const a = end * segments + i, b = end * segments + (i + 1) % segments;
      faces.push(end === 0 ? [center, b, a] : [center, a, b]);
    }
  }
  return mesh(triangles(points, faces), color, variation);
}

export function ellipsoid(at: Point, scale: Point, color: number, detail = 1, variation = 0.025, roughness = 0.86) {
  const m = mesh(new THREE.IcosahedronGeometry(1, detail), color, variation, roughness);
  m.position.set(...at);
  m.scale.set(...scale);
  return m;
}

/** A tapered, swept lock of hair with a six-sided cross-section. */
export function lock(path: Point[], widths: number[], depth: number, color: number) {
  const points: Point[] = [];
  for (let j = 0; j < path.length; j++) {
    const prev = path[Math.max(j - 1, 0)], next = path[Math.min(j + 1, path.length - 1)];
    const tangent = new THREE.Vector2(next[0] - prev[0], next[1] - prev[1]).normalize();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      const w = Math.cos(a) * widths[j];
      points.push([path[j][0] - tangent.y * w, path[j][1] + tangent.x * w, path[j][2] + Math.sin(a) * depth]);
    }
  }
  const faces: number[][] = [];
  for (let j = 0; j < path.length - 1; j++) for (let i = 0; i < 6; i++) {
    const a = j * 6 + i, b = j * 6 + (i + 1) % 6;
    faces.push([a, b, a + 6], [b, b + 6, a + 6]);
  }
  for (let i = 1; i < 5; i++) {
    const end = (path.length - 1) * 6;
    faces.push([0, i + 1, i], [end, end + i, end + i + 1]);
  }
  // Determine winding from the first ring; the path is free to sweep either way.
  const g = triangles(points, faces);
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  const radial = new THREE.Vector3(p.getX(0) - path[0][0], p.getY(0) - path[0][1], p.getZ(0) - path[0][2]);
  if (radial.dot(new THREE.Vector3(n.getX(0), n.getY(0), n.getZ(0))) < 0) {
    g.setIndex(faces.map(([a, b, c]) => [c, b, a]).flat());
  }
  return mesh(g, color, 0.055);
}

/** Consolidate a rigid part without swallowing any animation joints. */
export function bake(group: THREE.Group, animated: Set<THREE.Object3D>) {
  for (const child of [...group.children]) if (child instanceof THREE.Group) bake(child, animated);
  const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh) || child.children.length || animated.has(child) || Array.isArray(child.material)) continue;
    const bucket = buckets.get(child.material) ?? [];
    bucket.push(child);
    buckets.set(child.material, bucket);
  }
  for (const [material, parts] of buckets) {
    if (parts.length < 2) continue;
    const geometries = parts.map((part) => {
      part.updateMatrix();
      return part.geometry.clone().applyMatrix4(part.matrix);
    });
    const combined = mergeGeometries(geometries);
    for (const geometry of geometries) geometry.dispose();
    if (!combined) continue;
    const joined = new THREE.Mesh(combined, material);
    joined.name = `${group.name || 'mayor'}-surface`;
    joined.castShadow = joined.receiveShadow = true;
    for (const part of parts) { group.remove(part); part.geometry.dispose(); }
    group.add(joined);
  }
}
