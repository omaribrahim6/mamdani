import { Bell, Check, TriangleAlert, X } from 'lucide-react';
import { useCity } from '../lib/city';
import './toasts.css';

export function Toasts() {
  const { toasts, dismiss, open } = useCity();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone ?? 'info'}`} onClick={() => t.issueId && open(t.issueId)}>
          <span className="toast-ico">{t.tone === 'good' ? <Check size={14} /> : t.tone === 'bad' ? <TriangleAlert size={14} /> : <Bell size={14} />}</span>
          <div>
            <b>{t.title}</b>
            {t.body && <span>{t.body}</span>}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
