import * as THREE from 'three';

// Things Mamdani carries into the photo. Same flat-shaded, low-poly language as the character;
// units match the rig (he's ~1.18 tall), origin at the point that touches the ground.

const mat = (color: number, emissive = 0) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, metalness: 0, emissive, emissiveIntensity: emissive ? 1.4 : 0 });

function m(g: THREE.BufferGeometry, material: THREE.Material) {
  const mesh = new THREE.Mesh(g, material);
  mesh.castShadow = true;
  return mesh;
}

/** A traffic cone: orange body, two reflective bands, square base. */
export function makeCone() {
  const cone = new THREE.Group();
  cone.name = 'traffic-cone';
  const base = m(new THREE.BoxGeometry(0.26, 0.022, 0.26), mat(0xe8510f));
  base.position.y = 0.011;
  cone.add(base);
  const body = m(new THREE.CylinderGeometry(0.018, 0.098, 0.36, 10, 1, true), mat(0xff5a14));
  body.position.y = 0.2;
  cone.add(body);
  for (const [y, r0, r1] of [[0.17, 0.083, 0.071], [0.26, 0.057, 0.046]] as const) {
    const band = m(new THREE.CylinderGeometry(r1 + 0.002, r0 + 0.002, 0.04, 10, 1, true), mat(0xf4f4ef));
    band.position.y = y;
    cone.add(band);
  }
  const tip = m(new THREE.CylinderGeometry(0.012, 0.019, 0.02, 10), mat(0xff5a14));
  tip.position.y = 0.39;
  cone.add(tip);
  return cone;
}

/** Clipboard with a work order on it. Held flat-ish in the left hand. */
export function makeClipboard() {
  const board = new THREE.Group();
  board.name = 'clipboard';
  const back = m(new THREE.BoxGeometry(0.115, 0.153, 0.012), mat(0xa5774d));
  board.add(back);
  const paper = m(new THREE.BoxGeometry(0.099, 0.125, 0.003), mat(0xf6f4ee));
  paper.position.set(0, -0.008, 0.008);
  board.add(paper);
  const clip = m(new THREE.BoxGeometry(0.05, 0.018, 0.016), mat(0x8a8f96));
  clip.position.set(0, 0.07, 0.01);
  board.add(clip);
  for (let i = 0; i < 4; i++) {
    const line = m(new THREE.BoxGeometry(0.07, 0.004, 0.001), mat(0x9aa0a6));
    line.position.set(-0.005, 0.03 - i * 0.022, 0.0105);
    board.add(line);
  }
  // the check mark he ticks, hidden until he writes it
  const tick = m(new THREE.BoxGeometry(0.03, 0.007, 0.001), mat(0x12995a));
  tick.name = 'tick';
  tick.position.set(0.02, -0.045, 0.011);
  tick.rotation.z = 0.8;
  tick.visible = false;
  board.add(tick);
  return board;
}

/** Flashlight with a glowing lens; the beam is a soft cone. */
export function makeFlashlight() {
  const torch = new THREE.Group();
  torch.name = 'flashlight';
  const body = m(new THREE.CylinderGeometry(0.016, 0.016, 0.12, 8), mat(0x2b2e33));
  torch.add(body);
  const head = m(new THREE.CylinderGeometry(0.026, 0.018, 0.035, 8), mat(0x2b2e33));
  head.position.y = 0.075;
  torch.add(head);
  const lens = m(new THREE.CylinderGeometry(0.022, 0.022, 0.004, 10), mat(0xfff2b0, 0xffe07a));
  lens.position.y = 0.094;
  torch.add(lens);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.7, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.name = 'beam';
  beam.position.y = 0.45;
  beam.rotation.x = Math.PI;
  torch.add(beam);
  return torch;
}
