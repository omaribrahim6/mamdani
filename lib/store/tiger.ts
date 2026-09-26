import { Pool } from 'pg';
import { category, type CategoryId } from '../categories';
import { metersBetween, priorityOf } from '../priority';
import type { CityStats, Issue, Report, ReportResponse, Status } from '../types';
import { STATUS_LABEL } from '../types';
import { withStandard } from '../standards';
import { pgConfig } from './pg-url';
import type { NewIssue, Store } from './types';

// Tiger Data (TimescaleDB) store. Schema: db/schema.sql. Seed: `npm run db:setup`.

let pool: Pool | null = null;
const db = () =>
  (pool ??= new Pool({ ...pgConfig(), max: 5 }));

type Row = Record<string, unknown>;
const ms = (v: unknown) => (v ? new Date(v as string).getTime() : null);

function toIssue(r: Row, now = Date.now()): Issue {
  delete r.embedding;
  const base = {
    id: Number(r.id),
    category: r.category as CategoryId,
    title: r.title as string,
    summary: r.summary as string,
    lat: r.lat as number,
    lng: r.lng as number,
    address: r.address as string,
    severity: r.severity as number,
    safetyRisk: r.safety_risk as number,
    hazards: r.hazards as string[],
    accessibility: r.accessibility as Issue['accessibility'],
    department: r.department as string,
    status: r.status as Status,
    reports: r.reports as number,
    firstReportedAt: ms(r.first_reported_at)!,
    lastReportedAt: ms(r.last_reported_at)!,
    resolvedAt: ms(r.resolved_at),
    mediaId: (r.media_id as string) ?? null,
    box: (r.box as Issue['box']) ?? null,
    events: r.events as Issue['events'],
    updatedAt: ms(r.updated_at)!,
  };
  const p = priorityOf(base, now);
  return withStandard({ ...base, priority: p.total, priorityParts: p.parts });
}

function toReport(r: Row): Report {
  return {
    id: r.id as string,
    issueId: Number(r.issue_id),
    createdAt: ms(r.created_at)!,
    lat: r.lat as number,
    lng: r.lng as number,
    address: r.address as string,
    mediaId: (r.media_id as string) ?? null,
    transcript: r.transcript as string,
    analysis: r.analysis as Report['analysis'],
  };
}

async function insertReport(issueId: number, r: Omit<Report, 'id' | 'issueId'>) {
  const { rows } = await db().query(
    `insert into reports (issue_id, created_at, lat, lng, address, media_id, transcript, category, analysis)
     values ($1, to_timestamp($2 / 1000.0), $3, $4, $5, $6, $7, $8, $9) returning *`,
    [issueId, r.createdAt, r.lat, r.lng, r.address, r.mediaId, r.transcript, r.analysis.category, r.analysis],
  );
  return toReport(rows[0]);
}

export const tigerStore: Store = {
  kind: 'tiger',

  async listIssues() {
    const { rows } = await db().query(`select * from issues where status <> 'resolved' or resolved_at > now() - interval '3 days'`);
    return rows.map((r) => toIssue(r)).sort((a, b) => b.priority - a.priority);
  },

  async changedSince(ts) {
    const { rows } = await db().query(`select * from issues where updated_at > to_timestamp($1 / 1000.0)`, [ts]);
    return rows.map((r) => toIssue(r));
  },

  async getIssue(id) {
    const [i, r] = await Promise.all([
      db().query(`select * from issues where id = $1`, [id]),
      db().query(`select * from reports where issue_id = $1 order by created_at desc limit 100`, [id]),
    ]);
    if (!i.rows[0]) return null;
    return { issue: toIssue(i.rows[0]), reports: r.rows.map(toReport) };
  },

  async openNear(lat, lng, radiusM, cat, embedding) {
    // bounding box in SQL (indexed), exact distance in JS; photo similarity from pgvector
    const dLat = radiusM / 111_320;
    const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
    const { rows } = await db().query(
      `select *, case when $6::vector is null or embedding is null then null else 1 - (embedding <=> $6::vector) end as similarity
       from issues where status <> 'resolved' and category = $1 and lat between $2 and $3 and lng between $4 and $5`,
      [cat, lat - dLat, lat + dLat, lng - dLng, lng + dLng, embedding ? `[${embedding.join(',')}]` : null],
    );
    return rows
      .map((r) => ({ ...toIssue(r), similarity: r.similarity == null ? null : Number(r.similarity) }))
      .map((i) => ({ ...i, distance: metersBetween(lat, lng, i.lat, i.lng) }))
      .filter((i) => i.distance <= radiusM)
      .sort((a, b) => a.distance - b.distance);
  },

  async createIssue(n: NewIssue, first, embedding) {
    const now = Date.now();
    const { rows } = await db().query(
      `insert into issues (category, title, summary, lat, lng, address, severity, safety_risk, hazards, accessibility,
         department, status, reports, first_reported_at, last_reported_at, media_id, box, events, embedding)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1, to_timestamp($13/1000.0), to_timestamp($13/1000.0), $14, $15, $16, $17::vector)
       returning *`,
      [
        n.category, n.title, n.summary, n.lat, n.lng, n.address, n.severity, n.safetyRisk, JSON.stringify(n.hazards),
        n.accessibility, n.department, n.status, now, n.mediaId, n.box ? JSON.stringify(n.box) : null,
        JSON.stringify([{ at: now, kind: 'reported', note: 'First report' }]),
        embedding ? `[${embedding.join(',')}]` : null,
      ],
    );
    const issue = toIssue(rows[0]);
    return { issue, report: await insertReport(issue.id, first) };
  },

  async confirmIssue(id, r) {
    const now = Date.now();
    const event = JSON.stringify([{ at: now, kind: 'confirmed', note: 'Another resident reported this' }]);
    const { rows } = await db().query(
      `update issues set
         reports = reports + 1,
         last_reported_at = now(),
         severity = greatest(severity, $2),
         safety_risk = greatest(safety_risk, $3),
         accessibility = case when coalesce(array_position(array['none','low','moderate','critical'], $4::jsonb->>'impact'), 0)
                                 > coalesce(array_position(array['none','low','moderate','critical'], accessibility->>'impact'), 0)
                              then $4::jsonb else accessibility end,
         media_id = coalesce(media_id, $5),
         box = coalesce(box, $6),
         events = events || $7::jsonb,
         updated_at = now()
       where id = $1 returning *`,
      [id, r.analysis.severity, r.analysis.safetyRisk, JSON.stringify(r.analysis.accessibility), r.mediaId, r.analysis.box ? JSON.stringify(r.analysis.box) : null, event],
    );
    return { issue: toIssue(rows[0]), report: await insertReport(id, r) };
  },

  async setStatus(id, status, note) {
    const event = JSON.stringify([{ at: Date.now(), kind: 'status', note: note || STATUS_LABEL[status] }]);
    const { rows } = await db().query(
      `update issues set status = $2, resolved_at = case when $2 = 'resolved' then now() else null end,
         events = events || $3::jsonb, updated_at = now() where id = $1 returning *`,
      [id, status, event],
    );
    return rows[0] ? toIssue(rows[0]) : null;
  },

  async putMedia(data, mime) {
    const { rows } = await db().query(`insert into media (mime, data) values ($1, $2) returning id`, [mime, data]);
    return rows[0].id as string;
  },

  async getMedia(id) {
    const { rows } = await db().query(`select mime, data from media where id = $1`, [id]);
    return rows[0] ? { mime: rows[0].mime as string, data: rows[0].data as Buffer } : null;
  },

  async getSession(id) {
    const { rows } = await db().query(`select response from report_sessions where session_id = $1`, [id]);
    return rows[0] ? { response: (rows[0].response as ReportResponse | null) ?? null } : null;
  },

  async claimSession(id) {
    const { rowCount } = await db().query(`insert into report_sessions (session_id) values ($1) on conflict do nothing`, [id]);
    return rowCount === 1;
  },

  async completeSession(id, issueId, response) {
    await db().query(`update report_sessions set issue_id = $2, response = $3, completed_at = now() where session_id = $1`, [id, issueId, response]);
  },

  async releaseSession(id) {
    await db().query(`delete from report_sessions where session_id = $1 and response is null`, [id]);
  },

  async stats(): Promise<CityStats> {
    const [hourly, cats, fixed, open] = await Promise.all([
      db().query(
        `select extract(epoch from h.bucket) * 1000 as t, coalesce(sum(r.n), 0)::int as count
         from generate_series(date_trunc('hour', now()) - interval '47 hours', date_trunc('hour', now()), interval '1 hour') as h(bucket)
         left join reports_hourly r on r.bucket = h.bucket
         group by 1 order by 1`,
      ),
      db().query(`select category, count(*)::int as open from issues where status <> 'resolved' group by 1 order by 2 desc`),
      db().query(
        `select count(*) filter (where resolved_at >= date_trunc('day', now()))::int as today,
                percentile_cont(0.5) within group (order by extract(epoch from resolved_at - first_reported_at) / 3600) as median
         from issues where resolved_at is not null`,
      ),
      db().query(
        `select count(*)::int as open,
                count(*) filter (where accessibility->>'impact' in ('moderate','critical'))::int as access
         from issues where status <> 'resolved'`,
      ),
    ]);
    return {
      hourly: hourly.rows.map((r) => ({ t: Number(r.t), count: r.count as number })),
      byCategory: cats.rows.map((r) => ({ category: category(r.category as string).id, open: r.open as number })),
      openCount: open.rows[0].open,
      resolvedToday: fixed.rows[0].today,
      medianHoursToFix: fixed.rows[0].median == null ? null : Number(fixed.rows[0].median),
      accessibilityOpen: open.rows[0].access,
    };
  },
};
