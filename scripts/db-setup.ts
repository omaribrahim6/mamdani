// Set up Tiger Data: apply db/schema.sql, then seed two days of Ottawa reports.
//   npm run db:setup            schema + seed (skips seeding if issues already exist)
//   npm run db:setup -- --reset drop everything first
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { category, CATEGORY_IDS } from '../lib/categories';
import { SEED } from '../lib/seed';
import { STATUS_LABEL } from '../lib/types';
import { pgConfig } from '../lib/store/pg-url';

try {
  process.loadEnvFile('.env.local');
} catch {
  /* env from the shell */
}

const H = 3600e3;
const reset = process.argv.includes('--reset');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (.env.local)');
  const db = new Client(pgConfig());
  await db.connect();

  if (reset) {
    console.log('dropping existing tables');
    await db.query('drop materialized view if exists reports_hourly cascade');
    await db.query('drop table if exists reports, issues, media cascade');
  }

  // continuous aggregates can't be created inside a transaction, so run statements one by one
  const sql = readFileSync('db/schema.sql', 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of sql) {
    try {
      await db.query(stmt);
    } catch (e) {
      const msg = (e as Error).message;
      if (/already exists/.test(msg)) continue;
      throw new Error(`${msg}\n  in: ${stmt.slice(0, 120)}…`);
    }
  }
  console.log(`schema applied (${sql.length} statements)`);

  const { rows } = await db.query('select count(*)::int as n from issues');
  if (rows[0].n > 0) {
    console.log(`already seeded (${rows[0].n} issues). Use --reset to start over.`);
    await db.end();
    return;
  }

  const now = Date.now();
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  let reports = 0;

  for (const d of SEED) {
    const first = now - d.firstHoursAgo * H;
    const span = Math.max(0.2, (d.resolvedHoursAgo ? d.firstHoursAgo - d.resolvedHoursAgo : d.firstHoursAgo) * H);
    const times = [first, ...Array.from({ length: d.reports - 1 }, () => first + rnd() * span)].sort((a, b) => a - b);
    const access = { barrier: d.access[0] === 'critical' || d.access[0] === 'moderate', impact: d.access[0], notes: d.access[1] };
    const events: Array<{ at: number; kind: string; note: string }> = times.map((t, k) => ({
      at: t,
      kind: k ? 'confirmed' : 'reported',
      note: k ? 'Another resident reported this' : 'First report',
    }));
    if (d.status !== 'new') events.push({ at: first + span * 0.6, kind: 'status', note: STATUS_LABEL.assigned });
    if (d.status === 'in_progress' || d.status === 'resolved') events.push({ at: first + span * 0.8, kind: 'status', note: STATUS_LABEL.in_progress });
    const resolvedAt = d.status === 'resolved' ? now - (d.resolvedHoursAgo ?? 1) * H : null;
    if (resolvedAt) events.push({ at: resolvedAt, kind: 'status', note: STATUS_LABEL.resolved });
    events.sort((a, b) => a.at - b.at);

    const ins = await db.query(
      `insert into issues (category, title, summary, lat, lng, address, severity, safety_risk, hazards, accessibility, department,
         status, reports, first_reported_at, last_reported_at, resolved_at, events, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, to_timestamp($14/1000.0), to_timestamp($15/1000.0),
         case when $16::float8 is null then null else to_timestamp($16/1000.0) end, $17, now())
       returning id`,
      [
        d.category, d.title, d.summary, d.lat, d.lng, d.address, d.severity, d.safetyRisk, JSON.stringify(d.hazards), access,
        category(d.category).department, d.status, d.reports, first, times[times.length - 1], resolvedAt, JSON.stringify(events),
      ],
    );
    const id = ins.rows[0].id;
    const analysis = { isCivicIssue: true, category: d.category, title: d.title, summary: d.summary, severity: d.severity, safetyRisk: d.safetyRisk, hazards: d.hazards, accessibility: access, engine: 'demo' };
    for (const t of times) {
      const j = () => (rnd() - 0.5) * 0.00018;
      await db.query(
        `insert into reports (issue_id, created_at, lat, lng, address, category, analysis) values ($1, to_timestamp($2/1000.0), $3, $4, $5, $6, $7)`,
        [id, t, d.lat + j(), d.lng + j(), d.address, d.category, analysis],
      );
      reports++;
    }
  }

  // two days of background reports with a commuter rhythm, so the activity chart is real
  for (let h = 48; h > 0; h--) {
    const hour = new Date(now - h * H).getHours();
    const rush = hour >= 7 && hour <= 9 ? 3 : hour >= 16 && hour <= 18 ? 4 : hour >= 23 || hour <= 5 ? 0 : 1;
    for (let k = 0; k < rush + Math.round(rnd()); k++) {
      const cat = CATEGORY_IDS[Math.floor(rnd() * (CATEGORY_IDS.length - 1))];
      await db.query(
        `insert into reports (issue_id, created_at, lat, lng, category, analysis) values (0, to_timestamp($1/1000.0), 45.42, -75.69, $2, $3)`,
        [now - h * H + rnd() * H, cat, { category: cat, closed: true }],
      );
      reports++;
    }
  }
  await db.query(`call refresh_continuous_aggregate('reports_hourly', null, null)`);
  console.log(`seeded ${SEED.length} issues and ${reports} reports`);
  await db.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
