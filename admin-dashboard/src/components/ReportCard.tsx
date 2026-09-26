import { Accessibility, ChevronRight, MapPin, Users } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ApiIssue } from '../data/api';
import { category } from '../data/categories';
import { ago, STATUS_LABEL, ticketId, tier, urgency } from '../data/view';
import { useStages } from '../gl/GLProvider';

interface ReportCardProps {
  issue: ApiIssue;
  now: number;
  selected: boolean;
  onSelect: () => void;
  cardRef?: (el: HTMLButtonElement | null) => void;
}

export function ReportCard({ issue, now, selected, onSelect, cardRef }: ReportCardProps) {
  const { fx } = useStages();
  const el = useRef<HTMLButtonElement>(null);
  const cat = category(issue.category);
  const t = tier(issue);
  const u = urgency(issue, now);

  useEffect(() => {
    if (!fx || !el.current) return;
    return fx.frame(el.current, cat.color, u);
  }, [fx, cat.color, u]);

  return (
    <button
      ref={(n) => { el.current = n; cardRef?.(n); }}
      type="button"
      className={`report-card tier-${t.toLowerCase()}${selected ? ' is-selected' : ''}`}
      style={{ ['--tone' as string]: cat.color }}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Open ${ticketId(issue)}: ${issue.title}`}
      data-issue={issue.id}
    >
      <span className="card-stencil" aria-hidden="true">{cat.stencil}</span>
      <span className="card-topline">
        <span className={`priority-tag priority-${t.toLowerCase()}`}>{t}</span>
        <span className="card-score" title="Priority score">{issue.priority}</span>
        <span className="report-id">{ticketId(issue)}</span>
      </span>
      <span className="card-title">{issue.title}</span>
      <span className="card-address"><MapPin size={13} />{issue.address}</span>
      <span className="card-footer">
        <span className="card-status">{STATUS_LABEL[issue.status]}</span>
        <span className="card-meta">
          {issue.accessibility.impact === 'critical' && <Accessibility size={13} aria-label="Accessibility barrier" />}
          <span><Users size={13} /> {issue.reports}</span>
          <span>{ago(issue.lastReportedAt, now)}</span>
        </span>
        <ChevronRight className="card-arrow" size={16} aria-hidden="true" />
      </span>
    </button>
  );
}
