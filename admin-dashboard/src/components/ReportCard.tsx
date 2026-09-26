import { Camera, ChevronRight, MapPin } from 'lucide-react';
import type { ReportViewModel } from '../types';

interface ReportCardProps {
  report: ReportViewModel;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
}

export function ReportCard({ report, selected, compact, onSelect }: ReportCardProps) {
  return (
    <button
      type="button"
      className={`report-card${selected ? ' is-selected' : ''}${compact ? ' is-compact' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Open report ${report.id}: ${report.title}`}
    >
      <span className="card-topline">
        <span className={`priority-tag priority-${report.priority.toLowerCase()}`}>{report.priority}</span>
        <span className="report-id">{report.id}</span>
      </span>
      <span className="card-title">{report.title}</span>
      <span className="card-address"><MapPin size={14} />{report.address}</span>
      <span className="card-footer">
        <span><b>{report.category}</b><small>{report.status}</small></span>
        <span className="card-time">{report.reportedAt}<small><Camera size={13} /> {report.media.length || 'No'} {report.media.length === 1 ? 'photo' : 'photos'}</small></span>
        <ChevronRight className="card-arrow" size={18} aria-hidden="true" />
      </span>
    </button>
  );
}
