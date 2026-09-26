// Bakes OpenStreetMap extracts of downtown Ottawa into src/fixtures/twin.json for the 3D city.
// Data © OpenStreetMap contributors, ODbL 1.0 (attribution is shown in the console footer).
//
//   node scripts/build-twin.mjs <osm-network.json> [osm-buildings.json]
//
// Inputs are Overpass API JSON ("out geom"): highways + water for the network file, building
// ways for the buildings file. Coordinates are projected to metres around the table centre and
// stored as 1-decimal numbers in table units (1 unit = 100 m).
import fs from 'node:fs';

export const LAT0 = 45.4125, LNG0 = -75.6975;
const M = 100;
const K_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const K_LAT = 110_540;
const BOX = { s: 45.388, n: 45.438, w: -75.735, e: -75.662 };

const xz = (lat, lng) => [+(((lng - LNG0) * K_LNG) / M).toFixed(2), +((-(lat - LAT0) * K_LAT) / M).toFixed(2)];
const inBox = (g) => g.some((p) => p.lat > BOX.s && p.lat < BOX.n && p.lon > BOX.w && p.lon < BOX.e);

const CLASS = { motorway: 0, trunk: 0, primary: 1, secondary: 1, tertiary: 2, residential: 3, unclassified: 3, living_street: 3, pedestrian: 4 };

// Douglas-Peucker on a flat [x,z,x,z...] ring, tolerance in table units
function simplify(p, tol) {
  const pts = [];
  for (let i = 0; i + 1 < p.length; i += 2) pts.push([p[i], p[i + 1]]);
  if (pts.length < 5) return p;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bd = 0;
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const L = Math.hypot(bx - ax, bz - az) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (az - pts[i][1]) - (ax - pts[i][0]) * (bz - az)) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (bd > tol) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 4 ? out.flat() : p;
}

const [netPath, bldPath] = process.argv.slice(2);
const net = JSON.parse(fs.readFileSync(netPath, 'utf8')).elements;

const roads = [];
const water = [];
const waterLines = [];
for (const e of net) {
  if (e.type !== 'way' || !e.geometry || !inBox(e.geometry)) continue;
  const t = e.tags ?? {};
  const pts = e.geometry.flatMap((p) => xz(p.lat, p.lon));
  if (t.highway && CLASS[t.highway] !== undefined) roads.push({ c: CLASS[t.highway], p: pts });
  else if (t.natural === 'water' && pts.length >= 6) water.push(pts);
  else if (t.waterway) waterLines.push({ w: t.waterway === 'river' ? 1 : 0, p: pts });
}

const buildings = [];
if (bldPath && fs.existsSync(bldPath)) {
  for (const e of JSON.parse(fs.readFileSync(bldPath, 'utf8')).elements) {
    if (e.type !== 'way' || !e.geometry || e.geometry.length < 4 || !inBox(e.geometry)) continue;
    const t = e.tags ?? {};
    let h = parseFloat(t.height);
    if (!isFinite(h)) h = parseFloat(t['building:levels']) * 3.4;
    if (!isFinite(h)) h = 9 + (e.id % 7) * 1.5; // unknown: low-rise with a little variety
    const p = e.geometry.flatMap((g) => xz(g.lat, g.lon));
    let area = 0;
    for (let i = 0; i + 3 < p.length; i += 2) area += p[i] * p[i + 3] - p[i + 2] * p[i + 1];
    if (Math.abs(area / 2) * M * M < 40) continue; // sheds and kiosks
    buildings.push({ h: +(Math.min(h, 160) / M).toFixed(3), p: simplify(p, 0.012) });
  }
}

const out = { attribution: '© OpenStreetMap contributors (ODbL)', unit: `${M} m`, center: [LAT0, LNG0], roads, water, waterLines, buildings };
fs.writeFileSync(new URL('../src/fixtures/twin.json', import.meta.url), JSON.stringify(out));
console.log(`roads ${roads.length}, water ${water.length}, waterLines ${waterLines.length}, buildings ${buildings.length}`);
