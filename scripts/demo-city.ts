// A month of realistic Ottawa for the demo, written into Tiger Data next to the real reports.
//   npx tsx scripts/demo-city.ts            add ~380 issues and their resident reports (30 days)
//   npx tsx scripts/demo-city.ts --remove   delete everything this script added
//   npx tsx scripts/demo-city.ts --pulse    one new report right now (watch the dashboard react)
//
// Accuracy: every address is on a real Ottawa street, placed by the Mapbox geocoder (the civic
// number matched or placed on its block; anything outside the city is dropped); issue types follow the street (bike-lane
// problems only on streets with bike lanes, tree issues on residential streets); Gemini writes
// each report for that exact place and season; timing follows the city's daily rhythm; fix
// times are drawn around each type's service target, so some are late, like real life.
// Everything carries analysis.seed = 'demo-city-v1' so it can be removed cleanly.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Client } from 'pg';
import { embedText, json, MODELS } from '../lib/ai';
import { category, type CategoryId } from '../lib/categories';
import { SLA_HOURS } from '../lib/sla';
import { pgConfig } from '../lib/store/pg-url';
import { STATUS_LABEL, type AccessImpact, type Status } from '../lib/types';

try {
  process.loadEnvFile('.env.local');
} catch {
  /* env from the shell */
}

const TAG = 'demo-city-v1';
const H = 3600e3;
const DAYS = 30;
const TARGET = Number(process.env.DEMO_ISSUES || 380);
const MAPBOX = /VITE_MAPBOX_ACCESS_TOKEN="?([^"\n]+)/.exec(readFileSync('dashboard/.env', 'utf8'))?.[1] ?? '';

// deterministic randomness, so a rerun draws the same city
let seed = 20260926;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
function weighted<T>(items: Array<[T, number]>): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [v, w] of items) if ((r -= w) <= 0) return v;
  return items[items.length - 1][0];
}

// ── where: neighbourhoods, their streets, and plausible civic numbers ──
type Kind = 'arterial' | 'main' | 'residential';
interface Street {
  name: string;
  from: number;
  to: number;
  kind: Kind;
  bike?: boolean;
}
const S = (name: string, from: number, to: number, kind: Kind, bike = false): Street => ({ name, from, to, kind, bike });

const HOODS: Array<{ name: string; weight: number; streets: Street[] }> = [
  {
    name: 'Centretown',
    weight: 15,
    streets: [
      S('Bank St', 150, 600, 'main'),
      S('Elgin St', 150, 450, 'main'),
      S("O'Connor St", 100, 500, 'arterial', true),
      S('Metcalfe St', 100, 500, 'arterial'),
      S('Kent St', 100, 500, 'arterial'),
      S('Bay St', 100, 400, 'residential', true),
      S('Somerset St W', 100, 400, 'main'),
      S('Gloucester St', 100, 300, 'residential'),
      S('Nepean St', 100, 300, 'residential'),
      S('Lisgar St', 100, 300, 'residential'),
      S('Cooper St', 100, 300, 'residential'),
      S('MacLaren St', 100, 300, 'residential'),
      S('Gilmour St', 100, 300, 'residential'),
      S('Laurier Ave W', 100, 400, 'arterial', true),
      S('Slater St', 100, 300, 'arterial'),
    ],
  },
  {
    name: 'ByWard Market',
    weight: 9,
    streets: [
      S('Rideau St', 50, 400, 'main'),
      S('Dalhousie St', 100, 400, 'main'),
      S('Clarence St', 50, 300, 'residential'),
      S('York St', 50, 300, 'main'),
      S('George St', 50, 300, 'main'),
      S('Murray St', 100, 300, 'residential'),
      S('Sussex Dr', 300, 600, 'arterial'),
    ],
  },
  {
    name: 'Lowertown',
    weight: 5,
    streets: [
      S('King Edward Ave', 100, 500, 'arterial'),
      S('St. Patrick St', 100, 400, 'arterial'),
      S('Cumberland St', 100, 300, 'residential'),
      S('Beausoleil Dr', 100, 250, 'residential'),
      S('Bruyère St', 50, 200, 'residential'),
    ],
  },
  {
    name: 'Sandy Hill',
    weight: 7,
    streets: [
      S('Laurier Ave E', 50, 500, 'arterial', true),
      S('Somerset St E', 50, 300, 'residential'),
      S('Friel St', 100, 300, 'residential'),
      S('Chapel St', 100, 400, 'residential'),
      S('Wilbrod St', 100, 400, 'residential'),
      S('Stewart St', 100, 300, 'residential'),
      S('Nelson St', 100, 300, 'residential'),
    ],
  },
  {
    name: 'The Glebe',
    weight: 7,
    streets: [
      S('Bank St', 650, 1100, 'main'),
      S('Fifth Ave', 50, 250, 'residential'),
      S('First Ave', 50, 250, 'residential'),
      S('Glebe Ave', 50, 250, 'residential'),
      S('Holmwood Ave', 50, 200, 'residential'),
      S('Lyon St S', 400, 600, 'residential'),
      S('Powell Ave', 50, 200, 'residential'),
      S('Queen Elizabeth Dr', 400, 1000, 'arterial'),
    ],
  },
  {
    name: 'Little Italy',
    weight: 5,
    streets: [
      S('Preston St', 100, 600, 'main'),
      S('Booth St', 100, 500, 'arterial'),
      S('Rochester St', 100, 400, 'residential'),
      S('Norman St', 50, 200, 'residential'),
      S('Gladstone Ave', 400, 900, 'arterial'),
    ],
  },
  {
    name: 'Chinatown',
    weight: 3,
    streets: [S('Somerset St W', 600, 900, 'main'), S('Bronson Ave', 300, 600, 'arterial'), S('Arthur St', 50, 150, 'residential')],
  },
  {
    name: 'Hintonburg',
    weight: 6,
    streets: [
      S('Wellington St W', 900, 1300, 'main'),
      S('Parkdale Ave', 50, 300, 'arterial'),
      S('Holland Ave', 100, 300, 'arterial'),
      S('Armstrong St', 50, 300, 'residential'),
      S('Bayswater Ave', 100, 300, 'residential'),
      S('Hamilton Ave N', 50, 150, 'residential'),
      S('Spencer St', 50, 250, 'residential'),
    ],
  },
  {
    name: 'Westboro',
    weight: 6,
    streets: [
      S('Richmond Rd', 250, 500, 'main'),
      S('Churchill Ave N', 300, 400, 'arterial', true),
      S('Kirkwood Ave', 100, 500, 'arterial'),
      S('Byron Ave', 300, 600, 'residential'),
      S('Island Park Dr', 200, 600, 'arterial'),
      S('Roosevelt Ave', 300, 500, 'residential'),
      S('Scott St', 1500, 2100, 'arterial', true),
    ],
  },
  {
    name: 'Vanier',
    weight: 5,
    streets: [
      S('Montreal Rd', 50, 500, 'main'),
      S('McArthur Ave', 100, 400, 'arterial'),
      S('Marier Ave', 100, 300, 'residential'),
      S('Lafontaine Ave', 100, 300, 'residential'),
      S('Olmstead St', 100, 300, 'residential'),
    ],
  },
  {
    name: 'New Edinburgh',
    weight: 2,
    streets: [S('Beechwood Ave', 50, 300, 'main'), S('Crichton St', 100, 300, 'residential'), S('MacKay St', 100, 400, 'residential')],
  },
  {
    name: 'Old Ottawa South',
    weight: 4,
    streets: [
      S('Bank St', 1100, 1300, 'main'),
      S('Sunnyside Ave', 100, 400, 'residential'),
      S('Bronson Ave', 1000, 1300, 'arterial'),
      S('Seneca St', 50, 200, 'residential'),
    ],
  },
  { name: 'Old Ottawa East', weight: 2, streets: [S('Main St', 100, 300, 'arterial', true), S('Hawthorne Ave', 50, 200, 'residential')] },
  {
    name: 'Alta Vista',
    weight: 4,
    streets: [
      S('Alta Vista Dr', 1500, 2000, 'arterial'),
      S('Smyth Rd', 1500, 2000, 'arterial'),
      S('Kilborn Ave', 1500, 2000, 'residential'),
      S('Heron Rd', 1000, 1500, 'arterial'),
    ],
  },
  {
    name: 'Overbrook',
    weight: 3,
    streets: [S('St. Laurent Blvd', 800, 1500, 'arterial'), S('Ogilvie Rd', 1000, 1800, 'arterial'), S('Donald St', 100, 300, 'residential')],
  },
  {
    name: 'Carlington',
    weight: 4,
    streets: [
      S('Carling Ave', 900, 1800, 'arterial'),
      S('Merivale Rd', 1000, 1600, 'arterial'),
      S('Clyde Ave', 1000, 1400, 'arterial'),
      S('Woodroffe Ave', 700, 1500, 'arterial'),
    ],
  },
  {
    name: 'Nepean',
    weight: 4,
    streets: [
      S('Baseline Rd', 1000, 2000, 'arterial'),
      S('Greenbank Rd', 100, 500, 'arterial'),
      S('Meadowlands Dr W', 100, 400, 'arterial'),
      S('Prince of Wales Dr', 1000, 1600, 'arterial'),
    ],
  },
  {
    name: 'Riverview Park',
    weight: 3,
    streets: [S('Walkley Rd', 1000, 2000, 'arterial'), S('Riverside Dr', 1500, 2600, 'arterial'), S('Bank St', 2200, 2600, 'main')],
  },
  {
    name: 'Kanata',
    weight: 4,
    streets: [
      S('Hazeldean Rd', 5000, 5900, 'arterial'),
      S('March Rd', 100, 500, 'arterial'),
      S('Castlefrank Rd', 50, 400, 'arterial'),
      S('Campeau Dr', 100, 600, 'arterial'),
      S('Katimavik Rd', 100, 400, 'arterial'),
    ],
  },
  {
    name: 'Orléans',
    weight: 4,
    streets: [
      S('St. Joseph Blvd', 2000, 3500, 'main'),
      S('Innes Rd', 3000, 4000, 'arterial'),
      S('Tenth Line Rd', 1000, 2500, 'arterial'),
      S("Jeanne d'Arc Blvd N", 1000, 2000, 'arterial'),
    ],
  },
  {
    name: 'Barrhaven',
    weight: 3,
    streets: [S('Strandherd Dr', 3000, 3900, 'arterial'), S('Greenbank Rd', 3000, 4000, 'arterial'), S('Longfields Dr', 100, 400, 'arterial')],
  },
];

// ── what: how often each kind of problem comes in (late-September mix of Ottawa 311 volume) ──
const MIX: Record<Kind, Array<[CategoryId, number]>> = {
  main: [
    ['pothole', 14],
    ['waste', 22],
    ['graffiti', 16],
    ['streetlight', 9],
    ['sidewalk', 12],
    ['traffic', 9],
    ['drainage', 5],
    ['water', 4],
    ['tree', 4],
    ['other', 5],
  ],
  arterial: [
    ['pothole', 26],
    ['waste', 8],
    ['graffiti', 6],
    ['streetlight', 13],
    ['sidewalk', 10],
    ['traffic', 16],
    ['drainage', 9],
    ['water', 5],
    ['tree', 4],
    ['other', 3],
  ],
  residential: [
    ['pothole', 16],
    ['waste', 12],
    ['graffiti', 6],
    ['streetlight', 12],
    ['sidewalk', 14],
    ['traffic', 5],
    ['drainage', 8],
    ['water', 5],
    ['tree', 18],
    ['other', 4],
  ],
};

// ── when: the hours residents report things (commutes, lunch, evening walks) ──
const HOUR_WEIGHT = [0.3, 0.2, 0.1, 0.1, 0.1, 0.3, 0.9, 2.2, 3.0, 2.4, 1.8, 1.9, 2.6, 2.2, 1.8, 1.9, 2.5, 3.1, 2.9, 2.4, 1.9, 1.4, 0.9, 0.5];

interface Place {
  address: string;
  hood: string;
  street: Street;
  lat: number;
  lng: number;
}

const CACHE = '.data/demo-geocode.json';

async function geocode(q: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(q)}&country=ca&types=address&limit=1&proximity=-75.6972,45.4215&access_token=${MAPBOX}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = (await r.json()) as {
    features?: Array<{
      geometry: { coordinates: [number, number] };
      properties: { name?: string; match_code?: { confidence?: string; address_number?: string; street?: string }; context?: { place?: { name?: string } } };
    }>;
  };
  const f = j.features?.[0];
  const m = f?.properties.match_code;
  if (!f || !m) return null;
  // the right street in the City of Ottawa, with a civic number Mapbox knows or can place on its
  // block (Ottawa has few rooftop points in Mapbox; interpolated numbers land on the right block)
  const inOttawa = ['Ottawa', 'Kanata', 'Nepean', 'Orléans', 'Gloucester', 'Barrhaven', 'Vanier'].includes(f.properties.context?.place?.name ?? '');
  if (m.street !== 'matched' || !['matched', 'plausible'].includes(m.address_number ?? '') || !inOttawa) return null;
  const [lng, lat] = f.geometry.coordinates;
  if (lat < 45.2 || lat > 45.55 || lng < -76.0 || lng > -75.45) return null;
  return { lng, lat, label: q.replace(', Ottawa, ON', '') };
}

async function places(n: number): Promise<Place[]> {
  mkdirSync('.data', { recursive: true });
  const cache: Record<string, { lat: number; lng: number; label: string } | null> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
  const out: Place[] = [];
  const seen = new Set<string>();
  let tries = 0;
  while (out.length < n && tries < n * 4) {
    tries++;
    const hood = weighted(HOODS.map((h) => [h, h.weight] as [typeof h, number]));
    const street = pick(hood.streets);
    // civic numbers: odd and even sides, a realistic spread
    const num = Math.round((street.from + rnd() * (street.to - street.from)) / 2) * 2 + (rnd() < 0.5 ? 1 : 0);
    const q = `${num} ${street.name}, Ottawa, ON`;
    if (seen.has(q)) continue;
    seen.add(q);
    if (!(q in cache)) {
      cache[q] = await geocode(q);
      if (Object.keys(cache).length % 25 === 0) writeFileSync(CACHE, JSON.stringify(cache));
    }
    const g = cache[q];
    if (!g) continue;
    out.push({ address: `${g.label}, ${hood.name}`, hood: hood.name, street, lat: g.lat, lng: g.lng });
    if (out.length % 50 === 0) console.log(`  ${out.length} addresses confirmed (${tries} tried)`);
  }
  writeFileSync(CACHE, JSON.stringify(cache));
  return out;
}

interface Written {
  i: number;
  title: string;
  summary: string;
  infrastructure: string;
  severity: number;
  safetyRisk: number;
  hazards: string[];
  accessImpact: AccessImpact;
  accessNotes: string[];
  transcripts: string[];
}

const WRITE_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'number' },
          title: { type: 'string', description: 'what a city inspector would title it, max 8 words, specific' },
          summary: { type: 'string', description: 'one or two sentences a crew can act on: size, where exactly, what it affects' },
          infrastructure: { type: 'string' },
          severity: { type: 'number', minimum: 5, maximum: 98 },
          safetyRisk: { type: 'number', minimum: 0, maximum: 98 },
          hazards: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          accessImpact: { type: 'string', enum: ['none', 'low', 'moderate', 'critical'] },
          accessNotes: { type: 'array', items: { type: 'string' }, maxItems: 2 },
          transcripts: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3, description: 'what residents said to Mamdani when reporting, first person, casual, 1-2 sentences each, all different people' },
        },
        required: ['i', 'title', 'summary', 'infrastructure', 'severity', 'safetyRisk', 'hazards', 'accessImpact', 'accessNotes', 'transcripts'],
      },
    },
  },
  required: ['issues'],
};

async function write(batch: Array<{ i: number; place: Place; cat: CategoryId; when: number }>): Promise<Written[]> {
  const lines = batch
    .map((b) => `${b.i}. ${category(b.cat).label} (${b.cat}) at ${b.place.address} — ${b.place.street.kind} street${b.place.street.bike ? ' with a painted/protected bike lane' : ''}, reported ${new Date(b.when).toDateString()}`)
    .join('\n');
  const r = await json<{ issues: Written[] }>(
    MODELS.decide(),
    [
      {
        text: `You write realistic City of Ottawa 311-style issue records for a demo of a civic reporting app. It is late summer into early fall 2026 (September): leaves starting to fall, warm days, some heavy rain, construction season wrapping up, students back at uOttawa and Carleton.

For each numbered item, write the issue that a resident photographed at that exact place. Make it specific to the street and neighbourhood (mention a nearby landmark, cross street, bus stop, school, park or storefront type when plausible, but never invent business names). Vary sizes, causes and wording; don't repeat phrasing across items. Calibrate severity and safetyRisk honestly: most issues are moderate (30-65), a few are serious (75+), some are minor (<30). Accessibility impact 'critical' only when someone using a wheelchair or walker genuinely can't pass. Graffiti and garbage are usually low safety risk. Streetlights near crossings, open holes, and signal failures are high.

ITEMS:
${lines}`,
      },
    ],
    WRITE_SCHEMA,
    0.9,
  );
  return r.issues;
}

function hourAt(dayStart: number) {
  const h = weighted(HOUR_WEIGHT.map((w, k) => [k, w] as [number, number]));
  return dayStart + h * H + rnd() * H;
}

async function add() {
  if (!MAPBOX) throw new Error('No Mapbox token in dashboard/.env');
  const db = new Client(pgConfig());
  await db.connect();
  const existing = await db.query(`select count(*)::int as n from reports where analysis->>'seed' = $1`, [TAG]);
  if (existing.rows[0].n) throw new Error(`Demo city already loaded (${existing.rows[0].n} reports). Run with --remove first.`);

  console.log(`confirming ${TARGET} real Ottawa addresses with Mapbox…`);
  const where = await places(TARGET);
  const now = Date.now();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  // when each problem was first reported: a steady month, a bit more on weekdays, more after the big rain
  const plan = where.map((place, i) => {
    let when: number;
    do {
      const d = Math.floor(rnd() ** 1.25 * DAYS);
      const dayStart = today.getTime() - d * 24 * H;
      const dow = new Date(dayStart).getDay();
      if ((dow === 0 || dow === 6) && rnd() < 0.25) continue;
      when = hourAt(dayStart);
    } while (!when! || when! > now - 5 * 60e3);
    const cat = weighted(MIX[place.street.kind].concat(place.street.bike ? [['bike_lane', 14]] : []));
    return { i, place, cat, when: when! };
  });

  console.log(`writing ${plan.length} reports with Gemini (${MODELS.decide()})…`);
  const written = new Map<number, Written>();
  const batches: (typeof plan)[] = [];
  for (let k = 0; k < plan.length; k += 24) batches.push(plan.slice(k, k + 24));
  for (let k = 0; k < batches.length; k += 4) {
    const results = await Promise.all(
      batches.slice(k, k + 4).map((b) =>
        write(b).catch(async () => {
          await new Promise((r) => setTimeout(r, 2000));
          return write(b);
        }),
      ),
    );
    for (const w of results.flat()) written.set(w.i, w);
    console.log(`  ${written.size}/${plan.length}`);
  }

  console.log('filing issues, reports and history…');
  let issues = 0;
  let reports = 0;
  const embedQueue: Array<{ id: number; text: string }> = [];
  for (const p of plan) {
    const w = written.get(p.i);
    if (!w) continue;
    const cat = category(p.cat);
    const target = SLA_HOURS[p.cat] * (w.safetyRisk >= 75 ? 0.5 : 1);
    // how long this one takes: mostly inside the target, a tail that runs late, a few stuck
    const stuck = rnd() < 0.07;
    const fixHours = stuck ? 1e6 : target * Math.exp(Math.log(0.6) + (rnd() + rnd() + rnd() - 1.5) * 0.9) * (rnd() < 0.15 ? 2.2 : 1);
    const resolvedAt = p.when + fixHours * H <= now - 10 * 60e3 ? p.when + fixHours * H : null;
    const end = resolvedAt ?? now;
    const frac = (now - p.when) / (fixHours * H);
    const status: Status = resolvedAt ? 'resolved' : stuck ? (frac > 0 && rnd() < 0.5 ? 'new' : 'assigned') : frac < 0.3 ? 'new' : frac < 0.65 ? 'assigned' : 'in_progress';

    // how many residents report it: busier streets and worse problems draw more
    const pull = (w.severity / 100) * 1.6 + (p.place.street.kind === 'main' ? 0.9 : p.place.street.kind === 'arterial' ? 0.6 : 0.2);
    const extra = Math.min(20, Math.floor(-Math.log(rnd()) * pull));
    const times = [p.when];
    for (let k = 0; k < extra; k++) {
      const t = p.when + (end - p.when) * rnd() ** 1.8;
      if (t < now - 60e3) times.push(t);
    }
    times.sort((a, b) => a - b);

    const events: Array<{ at: number; kind: string; note: string }> = times.map((t, k) => ({ at: t, kind: k ? 'confirmed' : 'reported', note: k ? 'Another resident reported this' : 'First report' }));
    const span = resolvedAt ? resolvedAt - p.when : fixHours * H;
    const marks: Array<[Status, number]> = [
      ['assigned', p.when + span * (0.18 + rnd() * 0.12)],
      ['in_progress', p.when + span * (0.55 + rnd() * 0.15)],
      ['resolved', resolvedAt ?? Infinity],
    ];
    const order: Status[] = ['new', 'assigned', 'in_progress', 'resolved'];
    for (const [st, at] of marks) if (order.indexOf(st) <= order.indexOf(status) && at <= now) events.push({ at, kind: 'status', note: STATUS_LABEL[st] });
    events.sort((a, b) => a.at - b.at);

    const accessibility = { barrier: w.accessImpact === 'moderate' || w.accessImpact === 'critical', impact: w.accessImpact, notes: w.accessNotes };
    const { rows } = await db.query(
      `insert into issues (category, title, summary, lat, lng, address, severity, safety_risk, hazards, accessibility, department, status,
         reports, first_reported_at, last_reported_at, resolved_at, events, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, to_timestamp($14/1000.0), to_timestamp($15/1000.0), to_timestamp($16/1000.0), $17, to_timestamp($18/1000.0))
       returning id`,
      [
        p.cat,
        w.title,
        w.summary,
        p.place.lat,
        p.place.lng,
        p.place.address,
        Math.round(w.severity),
        Math.round(w.safetyRisk),
        JSON.stringify(w.hazards),
        JSON.stringify(accessibility),
        cat.department,
        status,
        times.length,
        times[0],
        times[times.length - 1],
        resolvedAt,
        JSON.stringify(events),
        events[events.length - 1].at,
      ],
    );
    const id = Number(rows[0].id);
    issues++;
    for (const [k, t] of times.entries()) {
      const jitter = () => (rnd() - 0.5) * 0.00022;
      const analysis = {
        isCivicIssue: true,
        category: p.cat,
        title: w.title,
        summary: w.summary,
        infrastructure: w.infrastructure,
        severity: Math.round(w.severity),
        safetyRisk: Math.round(w.safetyRisk),
        hazards: w.hazards,
        accessibility,
        box: null,
        transcript: w.transcripts[k] ?? '',
        mayorLine: '',
        mood: 'determined',
        confidence: 0.78 + rnd() * 0.2,
        engine: 'gemini',
        seed: TAG,
      };
      await db.query(
        `insert into reports (issue_id, created_at, lat, lng, address, transcript, category, analysis)
         values ($1, to_timestamp($2/1000.0), $3, $4, $5, $6, $7, $8)`,
        [id, t, p.place.lat + jitter(), p.place.lng + jitter(), p.place.address, w.transcripts[k] ?? '', p.cat, analysis],
      );
      reports++;
    }
    embedQueue.push({ id, text: `${cat.label}: ${w.title}. ${w.summary}` });
  }
  console.log(`  ${issues} issues, ${reports} resident reports`);

  // a fingerprint of each description in the same space as the photos, so "describe it" search finds them
  console.log('embedding descriptions with gemini-embedding-2…');
  let done = 0;
  for (let k = 0; k < embedQueue.length; k += 8) {
    await Promise.all(
      embedQueue.slice(k, k + 8).map(async (e) => {
        try {
          const v = await embedText(e.text);
          if (v) await db.query(`update issues set embedding = $2::vector where id = $1`, [e.id, `[${v.join(',')}]`]);
          done++;
        } catch (err) {
          console.warn('  embedding failed for', e.id, String(err).slice(0, 80));
        }
      }),
    );
  }
  console.log(`  ${done} embedded`);

  await db.query(`call refresh_continuous_aggregate('reports_hourly', null, null)`).catch((e) => console.warn('refresh aggregate:', String(e).slice(0, 120)));
  await db.end();
  console.log('done');
}

async function remove() {
  const db = new Client(pgConfig());
  await db.connect();
  const ids = await db.query(`select distinct issue_id from reports where analysis->>'seed' = $1`, [TAG]);
  const list = ids.rows.map((r) => Number(r.issue_id));
  await db.query(`delete from reports where analysis->>'seed' = $1`, [TAG]);
  if (list.length) await db.query(`delete from issues where id = any($1::bigint[])`, [list]);
  await db.query(`call refresh_continuous_aggregate('reports_hourly', null, null)`).catch(() => {});
  await db.end();
  console.log(`removed ${list.length} demo issues`);
}

/** One fresh report, filed now, at a real address: for showing the dashboard react live. */
async function pulse() {
  seed = (Date.now() % 2147483646) + 1; // a different street every time
  const db = new Client(pgConfig());
  await db.connect();
  const [p] = await places(1);
  const cat = weighted(MIX[p.street.kind]);
  const [w] = await write([{ i: 0, place: p, cat, when: Date.now() }]);
  const accessibility = { barrier: w.accessImpact === 'moderate' || w.accessImpact === 'critical', impact: w.accessImpact, notes: w.accessNotes };
  const now = Date.now();
  const { rows } = await db.query(
    `insert into issues (category, title, summary, lat, lng, address, severity, safety_risk, hazards, accessibility, department, status, reports, events)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'new',1,$12) returning id`,
    [cat, w.title, w.summary, p.lat, p.lng, p.address, Math.round(w.severity), Math.round(w.safetyRisk), JSON.stringify(w.hazards), JSON.stringify(accessibility), category(cat).department, JSON.stringify([{ at: now, kind: 'reported', note: 'First report' }])],
  );
  await db.query(`insert into reports (issue_id, lat, lng, address, transcript, category, analysis) values ($1,$2,$3,$4,$5,$6,$7)`, [
    rows[0].id,
    p.lat,
    p.lng,
    p.address,
    w.transcripts[0] ?? '',
    cat,
    { category: cat, title: w.title, summary: w.summary, severity: w.severity, safetyRisk: w.safetyRisk, accessibility, seed: TAG, engine: 'gemini' },
  ]);
  await db.end();
  console.log(`#${rows[0].id} ${category(cat).label}: ${w.title} — ${p.address}`);
}

const run = process.argv.includes('--remove') ? remove : process.argv.includes('--pulse') ? pulse : add;
run().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
