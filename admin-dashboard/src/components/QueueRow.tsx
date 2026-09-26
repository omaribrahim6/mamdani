import { Accessibility } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ApiIssue } from '../data/api';
import { category } from '../data/categories';
import { ago, STATUS_LABEL, ticketId, tier, urgency } from '../data/view';
import { useStages } from '../gl/GLProvider';

interface Props {
  issue: ApiIssue;
  now: number;
  selected: boolean;
  onSelect: () => void;
  rowRef?: (el: HTMLTableRowElement | null) => void;
}

// One row of the official-style queue table. The overlay canvas adds a heat shimmer around
// rows that are urgent or close to their service-standard due time.
export function QueueRow({ issue, now, selected, onSelect, rowRef }: Props) {
  const { fx } = useStages();
  const el = useRef<HTMLTableRowElement>(null);
  const cat = category(issue.category);
  const tr = tier(issue);
  const u = urgency(issue, now);

  useEffect(() => {
    if (!fx || !el.current) return;
    return fx.frame(el.current, tr === 'Urgent' ? '#f0524f' : tr === 'High' ? '#e0a526' : cat.color, tr === 'Urgent' || tr === 'High' ? u : 0);
  }, [fx, cat.color, u, tr]);

  return (
    <tr
      ref={(n) => { el.current = n; rowRef?.(n); }}
      className={`queue-row tier-${tr.toLowerCase()}${selected ? ' is-selected' : ''}`}
      style={{ ['--tone' as string]: cat.color }}
      onClick={onSelect}
      data-issue={issue.id}
    >
      <td className="mono">
        <button type="button" className="row-open" onClick={(e) => { e.stopPropagation(); onSelect(); }} aria-label={`Open ${ticketId(issue)}: ${issue.title}`}>{ticketId(issue)}</button>
      </td>
      <td>
        <span className="row-title"><i className="cat-dot" aria-hidden="true" />{issue.title}</span>
        <span className="row-sub">{cat.label} · {issue.address}{issue.accessibility.impact === 'critical' && <span className="a11y-flag"><Accessibility size={12} aria-hidden="true" /> barrier</span>}</span>
      </td>
      <td className="mono num">{issue.reports}</td>
      <td className="num"><span className={`tier-badge tier-${tr.toLowerCase()}`}>{tr}</span><span className="mono score">{issue.priority}</span></td>
      <td><span className="row-status">{STATUS_LABEL[issue.status]}</span><span className="row-sub">{ago(issue.lastReportedAt, now)}</span></td>
    </tr>
  );
}
