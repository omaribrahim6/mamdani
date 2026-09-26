import { useEffect, useMemo, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import {
  Accessibility,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Bell,
  CheckCircle2,
  CircleDot,
  Clock3,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Search,
  Users,
  X,
} from 'lucide-react';
import type { CityStats, Issue, IssueStatus } from '../types';

const statusLabel: Record<IssueStatus, string> = {
  new: 'Waiting',
  assigned: 'Assigned',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

const sampleIssues: Issue[] = [
  { id: 1842, category: 'sidewalk', title: 'Lifted concrete blocks wheelchair access', address: 'Dundas St W & Gladstone Ave', severity: 91, department: 'Transportation', status: 'assigned', reports: 7, updatedAt: Date.now() - 8 * 60_000, priority: 96 },
  { id: 1839, category: 'traffic_signal', title: 'Pedestrian signal remains dark', address: 'Parliament St & Carlton St', severity: 88, department: 'Signals', status: 'in_progress', reports: 4, updatedAt: Date.now() - 19 * 60_000, priority: 92 },
  { id: 1837, category: 'road', title: 'Deep pothole across eastbound lane', address: 'Queen St E & Coxwell Ave', severity: 74, department: 'Road Operations', status: 'new', reports: 11, updatedAt: Date.now() - 31 * 60_000, priority: 87 },
  { id: 1835, category: 'waste', title: 'Overflowing litter bins at transit stop', address: 'Bloor St W & Lansdowne Ave', severity: 48, department: 'Solid Waste', status: 'assigned', reports: 3, updatedAt: Date.now() - 52 * 60_000, priority: 61 },
];

const sampleStats: CityStats = {
  openCount: 128,
  resolvedToday: 34,
  medianHoursToFix: 18.6,
  accessibilityOpen: 12,
  byCategory: [
    { category: 'Roads', open: 42 },
    { category: 'Sidewalks', open: 31 },
    { category: 'Signals', open: 23 },
    { category: 'Waste', open: 18 },
    { category: 'Other', open: 14 },
  ],
};

function timeAgo(value: number) {
  const minutes = Math.max(1, Math.floor((Date.now() - value) / 60_000));
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

export function Dashboard() {
  const { user, logout } = useAuth0();
  const [issues, setIssues] = useState<Issue[]>(sampleIssues);
  const [stats, setStats] = useState<CityStats>(sampleStats);
  const [usingLiveData, setUsingLiveData] = useState(false);
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch('/api/issues', { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error('Issues request failed');
        return response.json() as Promise<{ issues: Issue[] }>;
      }),
      fetch('/api/stats', { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error('Stats request failed');
        return response.json() as Promise<CityStats>;
      }),
    ])
      .then(([issueData, statData]) => {
        setIssues(issueData.issues);
        setStats(statData);
        setUsingLiveData(true);
      })
      .catch(() => setUsingLiveData(false));
    return () => controller.abort();
  }, []);

  const visibleIssues = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return issues.slice(0, 8);
    return issues.filter((issue) =>
      `${issue.id} ${issue.title} ${issue.address} ${issue.department}`.toLowerCase().includes(normalized),
    );
  }, [issues, query]);

  const maxCategory = Math.max(...stats.byCategory.map((entry) => entry.open), 1);

  return (
    <div className="dashboard-shell">
      <aside className={menuOpen ? 'sidebar sidebar-open' : 'sidebar'}>
        <div className="brand-lockup sidebar-brand">
          <div className="seal" aria-hidden="true">CW</div>
          <span>Cityworks<br />Command</span>
        </div>
        <nav aria-label="Primary navigation">
          <a className="nav-item active" href="#overview"><LayoutDashboard size={19} /> Overview</a>
          <a className="nav-item" href="#issues"><CircleDot size={19} /> Issue queue <strong>{stats.openCount}</strong></a>
          <a className="nav-item" href="#map"><Map size={19} /> City map</a>
          <a className="nav-item" href="#crews"><Users size={19} /> Crews</a>
          <a className="nav-item" href="#reports"><BarChart3 size={19} /> Reports</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="system-status"><span /> Intake systems operational</div>
          <button className="logout-button" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>
            <LogOut size={18} /> Sign out
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button className="menu-button" aria-label="Toggle navigation" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X /> : <Menu />}
          </button>
          <div className="search-wrap">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search issues, streets, or departments" aria-label="Search issues" />
          </div>
          <button className="icon-button" aria-label="Notifications"><Bell size={19} /><span /></button>
          <div className="user-chip">
            {user?.picture ? <img src={user.picture} alt="" /> : <span>{user?.name?.charAt(0) ?? 'A'}</span>}
            <div><strong>{user?.name ?? 'Administrator'}</strong><small>Operations staff</small></div>
          </div>
        </header>

        <main className="dashboard-main" id="overview">
          <section className="page-intro">
            <div>
              <p className="date-line">Saturday, September 26</p>
              <h1>Operations overview</h1>
              <p>Priorities across the city, ordered by public impact.</p>
            </div>
            <div className={usingLiveData ? 'data-state live' : 'data-state'}>
              <span /> {usingLiveData ? 'Live city data' : 'Preview data'}
            </div>
          </section>

          <section className="metrics-grid" aria-label="City performance metrics">
            <article className="metric priority-metric">
              <span className="metric-icon"><AlertTriangle size={20} /></span>
              <div><strong>{stats.openCount}</strong><p>Open issues</p><small>Across all departments</small></div>
            </article>
            <article className="metric">
              <span className="metric-icon blue"><CheckCircle2 size={20} /></span>
              <div><strong>{stats.resolvedToday}</strong><p>Resolved today</p><small>Crews are on pace</small></div>
            </article>
            <article className="metric">
              <span className="metric-icon slate"><Clock3 size={20} /></span>
              <div><strong>{stats.medianHoursToFix ? `${stats.medianHoursToFix}h` : '—'}</strong><p>Median repair time</p><small>From report to resolution</small></div>
            </article>
            <article className="metric access-metric">
              <span className="metric-icon violet"><Accessibility size={20} /></span>
              <div><strong>{stats.accessibilityOpen}</strong><p>Access barriers</p><small>Require priority review</small></div>
            </article>
          </section>

          <section className="operations-grid">
            <article className="queue-panel" id="issues">
              <div className="panel-heading">
                <div><h2>Priority dispatch ledger</h2><p>Highest-impact reports needing action</p></div>
                <button className="text-button">View full queue <ArrowUpRight size={16} /></button>
              </div>
              <div className="issue-table" role="table" aria-label="Priority issues">
                <div className="issue-row issue-header" role="row">
                  <span>Priority</span><span>Issue</span><span>Department</span><span>Status</span><span>Updated</span>
                </div>
                {visibleIssues.length ? visibleIssues.map((issue) => (
                  <div className="issue-row" role="row" key={issue.id}>
                    <span className={`priority-score priority-${issue.priority >= 90 ? 'urgent' : issue.priority >= 75 ? 'high' : 'standard'}`}>{issue.priority}</span>
                    <div className="issue-title"><strong>{issue.title}</strong><small>#{issue.id} · {issue.address} · {issue.reports} report{issue.reports === 1 ? '' : 's'}</small></div>
                    <span className="department">{issue.department}</span>
                    <span className={`status status-${issue.status}`}>{statusLabel[issue.status]}</span>
                    <span className="updated">{timeAgo(issue.updatedAt)}</span>
                  </div>
                )) : <div className="empty-row">No issues match “{query}”.</div>}
              </div>
            </article>

            <aside className="category-panel">
              <div className="panel-heading"><div><h2>Open by service</h2><p>Current workload mix</p></div></div>
              <div className="category-chart">
                {stats.byCategory.map((entry) => (
                  <div className="category-row" key={entry.category}>
                    <div><span>{entry.category.replaceAll('_', ' ')}</span><strong>{entry.open}</strong></div>
                    <div className="bar-track"><span style={{ width: `${(entry.open / maxCategory) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
              <div className="dispatch-note">
                <span><AlertTriangle size={18} /></span>
                <div><strong>3 urgent reports are unassigned</strong><p>Review the queue before the 4:00 PM dispatch handoff.</p></div>
              </div>
            </aside>
          </section>
        </main>
      </div>
    </div>
  );
}
