import { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { FileText, LogOut } from 'lucide-react';
import { mockReports } from '../mockReports';
import { BrandMark } from './BrandMark';
import { ReportCard } from './ReportCard';
import { ReportDetail } from './ReportDetail';

export function Dashboard() {
  const { user, logout } = useAuth0();
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const selectedReport = mockReports.find((report) => report.id === selectedReportId) ?? null;

  useEffect(() => {
    if (!selectedReport) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedReportId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedReport]);

  return (
    <main className="console-canvas">
      <div className={`console-shell${selectedReport ? ' detail-open' : ''}`}>
        <aside className="console-sidebar">
          <BrandMark />
          <nav aria-label="Primary navigation">
            <a href="#reports" className="console-nav-active"><FileText size={18} /><span>Reports</span><b>{mockReports.length}</b></a>
          </nav>
          <div className="operator-block">
            <div className="operator-identity">
              {user?.picture ? <img src={user.picture} alt="" /> : <span>{user?.name?.charAt(0) ?? 'A'}</span>}
              <div><strong>{user?.name ?? 'City operator'}</strong><small>{user?.email ?? 'Operations staff'}</small></div>
            </div>
            <button type="button" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}><LogOut size={16} /><span>Sign out</span></button>
          </div>
        </aside>

        <section className="reports-workspace" id="reports">
          <div className={`reports-pane${selectedReport ? ' has-selection' : ''}`}>
            <header className="reports-header">
              <div><p>Saturday, September 26</p><h1>City reports</h1></div>
            </header>
            <div className="reports-summary">
              <p>Incoming field reports, ordered for review.</p>
              <span>{mockReports.length} active</span>
            </div>
            <div className="reports-list" aria-label="Active city reports">
              {mockReports.map((report) => (
                <ReportCard key={report.id} report={report} selected={report.id === selectedReportId} compact={Boolean(selectedReport)} onSelect={() => setSelectedReportId(report.id)} />
              ))}
            </div>
          </div>
          {selectedReport && <ReportDetail report={selectedReport} onClose={() => setSelectedReportId(null)} />}
        </section>
      </div>
    </main>
  );
}
