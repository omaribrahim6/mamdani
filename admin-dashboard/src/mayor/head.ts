import * as THREE from 'three';
import type { MayorOutfit } from './build';
import { ellipsoid, lock, mesh, panel, profile, triangles, type Point, type Ring } from './geometry';

const C = {
  skin: 0xe89a5c, skinLight: 0xf0a36b, skinShade: 0xc9814d, earInner: 0xb66b42,
  hair: 0x201b1c, hairLight: 0x282225, hairDark: 0x171518,
  beard: 0x28201b, beardLight: 0x34281f,
  eyeWhite: 0xf2e8df, iris: 0x493226, pupil: 0x171314, lip: 0xbc7048, mouth: 0x46251d,
  hardhat: 0xffb900, hardhatLight: 0xffc71a, hardhatShade: 0xc88d04, cap: 0x267549,
};
const mirror = (points: Point[], side: number): Point[] => points.map(([x, y, z]) => [x * side, y, z]);

// Broad temples, projecting cheeks, tapered jaw and rounded chin, individually sculpted.
const faceRings: Ring[] = [
  [0.025, 0.059, 0.081, 0.020], [0.043, 0.111, 0.113, 0.016],
  [0.072, 0.153, 0.136, 0.010], [0.110, 0.181, 0.153, 0.002],
  [0.152, 0.197, 0.163, 0], [0.194, 0.203, 0.169, 0],
  [0.230, 0.201, 0.171, 0], [0.266, 0.190, 0.166, -0.002],
  [0.307, 0.187, 0.163, -0.004], [0.348, 0.181, 0.157, -0.007],
  [0.384, 0.170, 0.143, -0.012], [0.418, 0.137, 0.114, -0.017],
  [0.440, 0.072, 0.064, -0.018], [0.447, 0.004, 0.004, -0.018],
];

function facePoint(y: number, angle: number, offset = 0): Point {
  let upper = faceRings.findIndex((r) => r[0] >= y);
  if (upper < 0) upper = faceRings.length - 1;
  const lo = faceRings[Math.max(0, upper - 1)], hi = faceRings[upper];
  const t = hi[0] === lo[0] ? 0 : (y - lo[0]) / (hi[0] - lo[0]);
  const w = THREE.MathUtils.lerp(lo[1], hi[1], t) + offset;
  const d = THREE.MathUtils.lerp(lo[2], hi[2], t) + offset;
  const z = THREE.MathUtils.lerp(lo[3] ?? 0, hi[3] ?? 0, t);
  const sx = Math.sin(angle), cz = Math.cos(angle);
  const front = Math.max(cz, 0);
  const cheek = Math.exp(-(((y - 0.204) / 0.037) ** 2)) * Math.exp(-(((Math.abs(sx) - 0.58) / 0.24) ** 2)) * 0.013;
  const socket = Math.exp(-(((y - 0.263) / 0.022) ** 2)) * Math.exp(-(((Math.abs(sx) - 0.40) / 0.22) ** 2)) * 0.007;
  return [sx * w, y, Math.sign(cz) * Math.abs(cz) ** (cz > 0 ? 0.58 : 1) * d + z + front * (cheek - socket)];
}

function headSurface(beard = false) {
  const segments = 40, rows = beard ? 8 : faceRings.length;
  const points: Point[] = [];
  for (let r = 0; r < rows; r++) for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2;
    let y = faceRings[r][0];
    if (beard) {
      const side = Math.abs(Math.sin(a));
      const top = Math.cos(a) < 0 ? 0.266 : 0.129 + 0.137 * side ** 5;
      y = THREE.MathUtils.lerp(0.025, top + Math.sin(i * 5.7) * 0.003, r / (rows - 1));
    }
    // Break up latitude bands with an irregular sculpt grid; preserve the silhouette.
    if (r > 0 && r < rows - 1) y += Math.sin(i * 2.13 + r * 1.77) * 0.006;
    points.push(facePoint(y, a, beard ? 0.006 : 0));
  }
  const faces: number[][] = [];
  for (let r = 0; r < rows - 1; r++) for (let i = 0; i < segments; i++) {
    const a = r * segments + i, b = r * segments + (i + 1) % segments;
    if ((r + i) % 2) faces.push([a, b, a + segments], [b, b + segments, a + segments]);
    else faces.push([a, b, b + segments], [a, b + segments, a + segments]);
  }
  const bottom = points.push([0, 0.024, 0.015]) - 1;
  for (let i = 0; i < segments; i++) faces.push([bottom, (i + 1) % segments, i]);
  return mesh(triangles(points, faces), beard ? C.beard : C.skin, beard ? 0.075 : 0.032);
}

function addEars(head: THREE.Group) {
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.name = `ear-${side}`;
    head.add(ear);
    ear.position.set(side * 0.198, 0.188, -0.007);
    ear.rotation.y = side * 0.30;
    ear.add(panel(mirror([
      [-0.014, 0.037, 0.013], [0.005, 0.047, 0.013], [0.030, 0.039, 0.006],
      [0.040, 0.017, 0.002], [0.039, -0.009, 0.003], [0.023, -0.039, 0.012],
      [0.005, -0.044, 0.020], [-0.012, -0.028, 0.022],
    ], side), C.skinShade, 0.024, 0.04));
    ear.add(panel(mirror([
      [0.002, 0.026, 0.017], [0.018, 0.031, 0.017], [0.028, 0.016, 0.014],
      [0.022, 0.006, 0.019], [0.024, -0.017, 0.019], [0.011, -0.028, 0.025],
      [0.003, -0.013, 0.030], [0.009, 0.002, 0.027],
    ], side), C.earInner, 0.003));
    ear.add(ellipsoid([side * 0.004, -0.008, 0.026], [0.010, 0.017, 0.008], C.skin));
  }
}

function addEyes(head: THREE.Group) {
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.name = `eye-${side}`;
    head.add(eye);
    eye.position.set(side * 0.082, 0.257, 0.164);
    eye.rotation.y = side * 0.17;
    eye.rotation.z = side * 0.065;
    // Almond sockets and sculpted lids; the eyes glance slightly up and to the side.
    const outline: Point[] = [
      [-0.045, -0.002, 0.006], [-0.032, 0.014, 0.014], [-0.013, 0.023, 0.019],
      [0.010, 0.024, 0.020], [0.030, 0.016, 0.014], [0.044, 0.001, 0.005],
      [0.030, -0.011, 0.014], [0.010, -0.015, 0.020], [-0.015, -0.014, 0.019], [-0.034, -0.010, 0.012],
    ];
    eye.add(panel(outline.map(([x, y, z]): Point => [x * 1.10, y * 1.20, z - 0.003]), C.skinShade, 0.004));
    eye.add(panel(outline, C.eyeWhite, 0.002, 0));
    const irisDisc = (radius: number, color: number, z: number) => {
      const contour: Point[] = [];
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2;
        contour.push([0.009 + Math.cos(a) * radius, Math.min(0.019, 0.011 + Math.sin(a) * radius * 1.06), z]);
      }
      eye.add(panel(contour, color, 0.001, 0.01));
    };
    irisDisc(0.018, C.iris, 0.025);
    irisDisc(0.0115, C.pupil, 0.027);
    eye.add(ellipsoid([0.003, 0.014, 0.029], [0.0036, 0.0034, 0.0015], 0xffffff, 1, 0, 0.44));
    eye.add(panel([
      [-0.047, -0.001, 0.008], [-0.033, 0.020, 0.017], [-0.014, 0.027, 0.023],
      [0.012, 0.028, 0.024], [0.034, 0.018, 0.017], [0.045, 0.001, 0.009],
      [0.030, 0.012, 0.019], [0.010, 0.019, 0.026], [-0.013, 0.018, 0.025], [-0.031, 0.011, 0.019],
    ], C.beard, 0.002));
    eye.add(panel([
      [-0.047, 0.002, 0.009], [-0.030, 0.028, 0.015], [-0.007, 0.034, 0.016],
      [0.023, 0.028, 0.014], [0.044, 0.005, 0.007], [0.032, 0.020, 0.017],
      [0.010, 0.029, 0.025], [-0.014, 0.028, 0.024], [-0.032, 0.019, 0.018],
    ], C.skin, 0.003));
    eye.add(panel([
      [-0.042, -0.009, 0.010], [-0.024, -0.017, 0.018], [0.010, -0.020, 0.021],
      [0.034, -0.012, 0.014], [0.043, -0.002, 0.007], [0.030, -0.009, 0.017],
      [0.010, -0.012, 0.024], [-0.019, -0.012, 0.022],
    ], C.skinLight, 0.003));
  }
  const eyebrow = (side: number) => {
    const brow = panel(mirror([
      [0.032, -0.008, 0.174], [0.036, 0.016, 0.173], [0.065, 0.023, 0.174],
      [0.094, 0.020, 0.168], [0.119, 0.005, 0.155], [0.132, -0.017, 0.144],
      [0.106, -0.003, 0.166], [0.076, 0.001, 0.182], [0.049, -0.005, 0.186],
    ], side), C.hairDark, 0.012, 0.03);
    brow.name = `brow-${side}`;
    brow.geometry.translate(-side * 0.082, 0, -0.170);
    brow.position.set(side * 0.082, 0.305, 0.170);
    head.add(brow);
    return brow;
  };
  return { browL: eyebrow(1), browR: eyebrow(-1) };
}

function addNoseAndSmile(head: THREE.Group) {
  const rows = [
    [0.296, 0.015, 0.180, 0.167], [0.261, 0.020, 0.207, 0.162],
    [0.225, 0.022, 0.223, 0.169], [0.199, 0.032, 0.239, 0.181],
    [0.184, 0.039, 0.230, 0.189], [0.176, 0.023, 0.207, 0.188],
  ];
  const points: Point[] = [];
  for (const [y, w, z, edge] of rows) points.push([-w, y, edge], [-w * 0.60, y, z - 0.005], [w * 0.56, y, z], [w, y, edge]);
  const faces: number[][] = [];
  for (let r = 0; r < rows.length - 1; r++) for (let i = 0; i < 3; i++) {
    const a = r * 4 + i;
    faces.push([a, a + 4, a + 1], [a + 1, a + 4, a + 5]);
  }
  head.add(mesh(triangles(points, faces), C.skin, 0.018));
  for (const s of [-1, 1]) {
    head.add(ellipsoid([s * 0.031, 0.186, 0.214], [0.014, 0.012, 0.021], C.skinShade, 1));
    head.add(panel(mirror([[0.017, 0.178, 0.227], [0.026, 0.180, 0.235], [0.037, 0.182, 0.220], [0.030, 0.175, 0.219]], s), 0x814a31, 0.003));
  }
  // Curved strips follow the muzzle in depth, keeping the closed smile delicate.
  const strip = (columns: number, rows: number, point: (u: number, v: number) => Point, color: number, variation = 0.02) => {
    const vertices: Point[] = [], indices: number[][] = [];
    for (let r = 0; r < rows; r++) for (let i = 0; i < columns; i++) vertices.push(point(i / (columns - 1) * 2 - 1, r / (rows - 1)));
    for (let r = 0; r < rows - 1; r++) for (let i = 0; i < columns - 1; i++) {
      const a = r * columns + i;
      indices.push([a, a + 1, a + columns], [a + 1, a + columns + 1, a + columns]);
    }
    return mesh(triangles(vertices, indices), color, variation);
  };
  head.add(strip(13, 4, (u, v) => {
    const lower = 0.103 + 0.034 * u * u, upper = 0.177 - 0.024 * u * u;
    return [u * 0.089, THREE.MathUtils.lerp(lower, upper, v), 0.188 - 0.023 * u * u + Math.sin(v * Math.PI) * 0.009];
  }, C.skinShade));
  const smileY = (u: number) => 0.136 + 0.013 * u * u + 0.005 * u;
  const mouth = strip(15, 2, (u, v) => [u * 0.079, smileY(u) - 0.136 - (1 - v) * 0.006 * (1 - u * u), -0.021 * u * u], C.mouth, 0);
  mouth.position.set(0, 0.136, 0.202);
  mouth.name = 'speaking-mouth';
  head.add(mouth);
  head.add(strip(15, 3, (u, v) => [u * 0.080, smileY(u) - (0.006 + (1 - v) * 0.006) * (1 - u * u), 0.201 - 0.021 * u * u + Math.sin(v * Math.PI) * 0.001], C.skinLight));
  head.add(strip(25, 3, (u, v) => {
    const top = 0.180 - 0.025 * u * u - 0.020 * Math.abs(u) ** 8 - 0.004 * Math.exp(-((u / 0.13) ** 2));
    const lower = 0.144 - 0.020 * u * u + Math.sin(u * 61) * 0.0015;
    return [u * 0.105, THREE.MathUtils.lerp(lower, top, v), 0.204 - 0.040 * u * u + Math.sin(v * Math.PI) * 0.005];
  }, C.beard, 0.05));
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const a = s * (0.57 + i * 0.17);
      const start = facePoint(0.127 + i * 0.006, a, 0.009);
      const mid = facePoint(0.097 + i * 0.001, a * 0.91, 0.011);
      const end = facePoint(0.071 + i * 0.001, a * 0.82, 0.007);
      head.add(lock([start, mid, end], [0.008, 0.012, 0.001], 0.005, i % 2 ? C.beard : C.beardLight));
    }
  }
  head.add(panel([[-0.020, 0.121, 0.201], [0.025, 0.123, 0.202], [0.019, 0.092, 0.185], [0.002, 0.083, 0.179], [-0.016, 0.093, 0.185]], C.beard, 0.008));
  for (let i = -2; i <= 2; i++) {
    const x = i * 0.022;
    head.add(lock([[x, 0.081, 0.151], [x + 0.004, 0.056, 0.151], [x * 0.8, 0.034, 0.118]], [0.009, 0.015, 0.004], 0.009, i % 2 ? C.beardLight : C.beard));
  }
  return mouth;
}

function addHair(head: THREE.Group, covered: boolean) {
  const points: Point[] = [], faces: number[][] = [];
  const segments = 40, rows = 12;
  for (let r = 0; r < rows; r++) for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2;
    const front = Math.max(0, Math.cos(a));
    const sweep = Math.sin(a) < 0 ? (covered ? 0.018 : 0.045) * front : 0;
    const base = 0.248 + front * 0.146 - sweep;
    const t = r / (rows - 1);
    const y = base + ((covered ? 0.449 : 0.466) - base) * Math.sin(t * Math.PI / 2);
    const p = facePoint(Math.min(y, 0.446), a, 0.020);
    p[1] = y;
    points.push(p);
  }
  for (let r = 0; r < rows - 1; r++) for (let i = 0; i < segments; i++) {
    const a = r * segments + i, b = r * segments + (i + 1) % segments;
    faces.push([a, b, b + segments], [a, b + segments, a + segments]);
  }
  head.add(mesh(triangles(points, faces), C.hair, 0.085));
  for (const s of [-1, 1]) head.add(panel(mirror([
    [0.177, 0.346, 0.066], [0.200, 0.320, 0.030], [0.204, 0.259, 0.025],
    [0.194, 0.219, 0.050], [0.182, 0.189, 0.078], [0.178, 0.239, 0.076], [0.165, 0.282, 0.093],
  ], s), C.hairDark, 0.026));
  if (covered) {
    head.add(lock([[0.11, 0.401, 0.128], [0.012, 0.391, 0.162], [-0.10, 0.361, 0.146]], [0.021, 0.029, 0.003], 0.016, C.hairDark));
    return;
  }
  // Broad swept waves, layered across the crown and forehead, with tapered tips.
  const locks: Array<[Point[], number[], number]> = [
    [[[0.137, 0.410, 0.075], [0.072, 0.471, 0.078], [-0.023, 0.472, 0.072], [-0.117, 0.435, 0.080]], [0.017, 0.041, 0.042, 0.004], 0.025],
    [[[0.125, 0.429, 0.110], [0.059, 0.451, 0.135], [-0.028, 0.430, 0.163], [-0.136, 0.358, 0.147]], [0.012, 0.044, 0.046, 0.003], 0.026],
    [[[0.073, 0.432, 0.142], [-0.007, 0.418, 0.177], [-0.078, 0.381, 0.183], [-0.155, 0.325, 0.122]], [0.017, 0.034, 0.043, 0.002], 0.022],
    [[[0.111, 0.397, 0.137], [0.070, 0.413, 0.164], [0.013, 0.392, 0.178], [-0.052, 0.356, 0.170]], [0.011, 0.024, 0.031, 0.001], 0.016],
    [[[-0.047, 0.463, 0.030], [-0.135, 0.431, 0.077], [-0.181, 0.388, 0.092], [-0.195, 0.350, 0.077]], [0.025, 0.037, 0.032, 0.003], 0.026],
    [[[-0.097, 0.435, -0.026], [-0.190, 0.402, 0.018], [-0.222, 0.355, 0.026], [-0.203, 0.299, 0.021]], [0.020, 0.037, 0.035, 0.004], 0.024],
    [[[-0.176, 0.369, 0.081], [-0.213, 0.340, 0.076], [-0.216, 0.298, 0.065], [-0.189, 0.256, 0.049]], [0.012, 0.031, 0.026, 0.002], 0.019],
    [[[0.088, 0.451, -0.020], [0.153, 0.436, 0.022], [0.191, 0.401, 0.043], [0.187, 0.345, 0.049]], [0.014, 0.032, 0.030, 0.002], 0.025],
    [[[0.130, 0.430, 0.074], [0.177, 0.410, 0.097], [0.193, 0.367, 0.075], [0.184, 0.314, 0.065]], [0.016, 0.025, 0.025, 0.002], 0.019],
    [[[-0.142, 0.400, -0.080], [-0.192, 0.362, -0.084], [-0.215, 0.302, -0.066], [-0.180, 0.260, -0.065]], [0.021, 0.036, 0.035, 0.003], 0.020],
  ];
  locks.forEach(([path, widths, depth], i) => head.add(lock(path, widths, depth, [C.hair, C.hairLight, C.hairDark][i % 3])));
  for (const [i, at] of ([
    [0.065, 0.463, 0.105], [0.004, 0.469, 0.083], [-0.055, 0.450, 0.132],
    [-0.112, 0.417, 0.136], [-0.158, 0.371, 0.108], [-0.195, 0.331, 0.058],
    [0.136, 0.432, 0.069], [0.176, 0.392, 0.061],
  ] as Point[]).entries()) {
    const wave = ellipsoid(at, [0.046, 0.030, 0.027], i % 2 ? C.hair : C.hairLight, 1, 0.055);
    wave.rotation.z = 0.42;
    head.add(wave);
  }
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.65 + i * 0.115), x = Math.sin(a), z = Math.cos(a);
    head.add(lock([[x * 0.12, 0.423, z * 0.13 - 0.02], [x * 0.20, 0.356, z * 0.18 - 0.025], [x * 0.19, 0.262, z * 0.16 - 0.025]], [0.019, 0.040, 0.002], 0.019, C.hair));
  }
}

function addHardhat(head: THREE.Group, color: number) {
  const hat = new THREE.Group();
  hat.name = 'hardhat';
  hat.scale.y = 1.16;
  hat.position.y = 0.032 - 0.356 * 0.16;
  head.add(hat);
  const shell: Ring[] = [
    [0.356, 0.219, 0.191, -0.017], [0.378, 0.219, 0.191, -0.017],
    [0.417, 0.207, 0.181, -0.019], [0.463, 0.175, 0.157, -0.019],
    [0.497, 0.113, 0.107, -0.019], [0.509, 0.062, 0.064, -0.019],
  ];
  hat.add(profile(shell, color, 20, 1, 0.023));
  const points: Point[] = [], faces: number[][] = [];
  const n = 32;
  for (const [radius, y] of [[1, 0.355], [1, 0.366], [0.82, 0.367], [0.82, 0.355]]) for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    points.push([Math.sin(a) * 0.247 * radius, y + Math.cos(a) * 0.007, Math.cos(a) * (Math.cos(a) > 0 ? 0.266 : 0.213) * radius - 0.014]);
  }
  for (let r = 0; r < 4; r++) for (let i = 0; i < n; i++) {
    const a = r * n + i, b = r * n + (i + 1) % n, c = ((r + 1) % 4) * n + i, d = ((r + 1) % 4) * n + (i + 1) % n;
    faces.push([a, b, c], [b, d, c]);
  }
  hat.add(mesh(triangles(points, faces), color, 0.02));
  hat.add(profile([[0.351, 0.219, 0.191, -0.017], [0.357, 0.222, 0.195, -0.017]], C.hardhatShade, 20));
  const shellHeight = (x: number, z: number) => {
    let lo = shell[0][0], hi = shell[shell.length - 1][0];
    for (let step = 0; step < 16; step++) {
      const y = (lo + hi) / 2;
      const upper = shell.findIndex((r) => r[0] >= y);
      const a = shell[Math.max(0, upper - 1)], b = shell[upper];
      const t = (y - a[0]) / (b[0] - a[0]);
      const w = THREE.MathUtils.lerp(a[1], b[1], t), d = THREE.MathUtils.lerp(a[2], b[2], t);
      const center = THREE.MathUtils.lerp(a[3] ?? 0, b[3] ?? 0, t);
      if ((x / w) ** 2 + ((z - center) / d) ** 2 < 1) lo = y;
      else hi = y;
    }
    return (lo + hi) / 2;
  };
  // Three moulded ribs conform to the shell, including their side edges.
  for (const x of [-0.119, 0, 0.119]) {
    const width = x === 0 ? 0.027 : 0.012;
    const vertices: Point[] = [];
    const extent = 0.190 * Math.sqrt(1 - ((Math.abs(x) + width) / 0.219) ** 2);
    for (let i = 0; i < 15; i++) {
      const z = -0.017 + extent * Math.cos(i / 14 * Math.PI);
      for (const [dx, raised] of [[-width, 0.001], [-width * 0.78, 0.006], [width * 0.78, 0.006], [width, 0.001]]) {
        vertices.push([x + dx, shellHeight(x + dx, z) + raised, z]);
      }
    }
    const f: number[][] = [];
    for (let j = 0; j < 14; j++) for (let k = 0; k < 3; k++) {
      const a = j * 4 + k;
      f.push([a, a + 1, a + 4], [a + 1, a + 5, a + 4]);
    }
    hat.add(mesh(triangles(vertices, f), color === C.hardhat ? C.hardhatLight : color, 0.015));
  }
}

export function sculptHead(outfit: MayorOutfit) {
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 0.6;
  head.scale.setScalar(1.17);
  head.add(headSurface(), headSurface(true));
  addEars(head);
  const { browL, browR } = addEyes(head);
  const mouth = addNoseAndSmile(head);
  const hatColor = outfit === 'construction' ? C.hardhat : outfit === 'electrician' ? 0xeee9db : outfit === 'traffic' ? 0xf78b1d : null;
  addHair(head, hatColor !== null || outfit === 'sanitation');
  if (hatColor !== null) addHardhat(head, hatColor);
  if (outfit === 'sanitation') {
    const cap = mesh(new THREE.SphereGeometry(0.216, 16, 7, 0, Math.PI * 2, 0, Math.PI / 2), C.cap);
    cap.scale.set(1, 0.66, 0.9);
    cap.position.set(0, 0.351, -0.014);
    head.add(cap);
    const visor = mesh(new THREE.CylinderGeometry(0.170, 0.170, 0.009, 12), C.cap);
    visor.scale.z = 0.8;
    visor.position.set(0, 0.354, 0.150);
    head.add(visor);
  }
  // Seat the chin just above the collar; the head joint itself keeps its animation baseline.
  for (const child of head.children) child.position.y -= 0.024;
  return { head, mouth, browL, browR };
}
