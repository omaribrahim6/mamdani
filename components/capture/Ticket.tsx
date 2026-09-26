'use client';

import { category } from '@/lib/categories';
import type { Analysis, SubmitResult } from '@/lib/types';
import s from './capture.module.css';

const IMPACT: Record<Analysis['accessibility']['impact'], string> = {
  none: 'No barrier seen',
  low: 'Minor',
  moderate: 'Barrier',
  critical: 'Blocks the way',
};

function Meter({ value, color }: { value: number; color: string }) {
  return (
    <span className={s.meter} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} style={i < Math.round(value / 10) ? { background: color } : undefined} />
      ))}
    </span>
  );
}

const ordinal = (n: number) => {
  const v = n % 100;
  return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th');
};

export function Ticket({
  analysis,
  result,
  open,
  stamped,
  onToggle,
  onAgain,
  onTrack,
}: {
  analysis: Analysis;
  result: SubmitResult;
  open: boolean;
  stamped: boolean;
  onToggle: () => void;
  onAgain: () => void;
  onTrack: () => void;
}) {
  const { issue } = result;
  const cat = category(issue.category);
  const acc = analysis.accessibility;
  return (
    <section className={s.ticket} data-open={open} aria-label={`Work order ${issue.id}`}>
      <button className={s.ticketHead} onClick={onToggle} aria-expanded={open}>
        <span className={s.grab} aria-hidden="true" />
        <span className={s.woNo}>Work order {issue.id}</span>
        <span className={s.woTitle}>{analysis.title}</span>
        <span className={s.woWhere}>{issue.address}</span>
        <span className={s.woChips}>
          <span className={s.chipCat} style={{ ['--c' as string]: cat.color }}>
            {cat.label}
          </span>
          {acc.barrier && <span className={s.chipAccess}>Accessibility barrier</span>}
          {result.duplicate && <span className={s.chipPlain}>{issue.reports} reports</span>}
        </span>
        <span className={s.stamp} data-in={stamped} aria-hidden={!stamped}>
          Sent to
          <br />
          the city
        </span>
      </button>

      <div className={s.ticketBody} hidden={!open}>
        <dl className={s.rows}>
          <div>
            <dt>Severity</dt>
            <dd>
              <Meter value={analysis.severity} color={cat.color} />
              <b>{analysis.severity}</b>
            </dd>
          </div>
          <div>
            <dt>Safety risk</dt>
            <dd>
              <Meter value={analysis.safetyRisk} color="var(--hivis)" />
              <b>{analysis.safetyRisk}</b>
            </dd>
          </div>
          <div>
            <dt>Accessibility</dt>
            <dd className={s.stack}>
              <b>{IMPACT[acc.impact]}</b>
              {acc.notes.map((n) => (
                <span key={n}>{n}</span>
              ))}
            </dd>
          </div>
          {analysis.hazards.length > 0 && (
            <div>
              <dt>Hazards</dt>
              <dd>{analysis.hazards.join(', ')}</dd>
            </div>
          )}
          <div>
            <dt>Goes to</dt>
            <dd>{issue.department}</dd>
          </div>
          <div>
            <dt>Reports</dt>
            <dd>
              {result.duplicate
                ? `You’re the ${ordinal(issue.reports)} person to report this. It moves up the queue with every report.`
                : 'You’re the first to report this.'}
            </dd>
          </div>
        </dl>
        <p className={s.summary}>
          <span>What the crew will read</span>
          {analysis.summary}
        </p>
        {analysis.engine === 'demo' && <p className={s.demoNote}>Demo analysis: add a Gemini key to analyze real photos.</p>}
      </div>

      <div className={s.ticketActions}>
        <button className="btn btn-ghost" onClick={onTrack}>
          Track this report
        </button>
        <button className="btn btn-primary" onClick={onAgain}>
          Report something else
        </button>
      </div>
    </section>
  );
}
