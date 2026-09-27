import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Heart, MapPin, MessageCircle, Share2, Sparkles } from 'lucide-react';
import type { Issue } from '@shared/types';
import { api } from '../lib/api';
import { ago, category, hood, STATUS_SHORT, street } from '../lib/format';
import { CategoryIcon, StatusLabel } from '../components/ui';
import './feed.css';

// Mamdani Social: every report residents file is also a public post, so the city is answering
// in the open. Same database and same Gemini write-up as the dashboard. There are no accounts
// yet, so posts are spread across the team's four names by work-order number.

const PEOPLE = [
  { name: 'Andy', handle: 'andy', color: '#2f6bff' },
  { name: 'Nicholas', handle: 'nicholas', color: '#12995a' },
  { name: 'Leo', handle: 'leo', color: '#8a3fd6' },
  { name: 'Omar', handle: 'omar', color: '#ff6a13' },
];
const author = (i: Issue) => PEOPLE[i.id % PEOPLE.length];

type Tab = 'latest' | 'trending' | 'fixed';

export function Feed() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [tab, setTab] = useState<Tab>('latest');
  const [liked, setLiked] = useState<Set<number>>(new Set());
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'Mamdani Social';
    let alive = true;
    const load = () => api.issues().then((r) => alive && setIssues(r.issues)).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const posts = useMemo(() => {
    const list = tab === 'fixed' ? issues.filter((i) => i.status === 'resolved') : issues.filter((i) => i.status !== 'resolved');
    return [...list].sort(tab === 'trending' ? (a, b) => b.reports - a.reports : (a, b) => b.firstReportedAt - a.firstReportedAt).slice(0, 40);
  }, [issues, tab]);

  useGSAP(() => {
    gsap.from('.post', { y: 20, opacity: 0, duration: 0.5, stagger: 0.05 });
  }, { scope: root, dependencies: [tab, posts.length > 0] });

  const fixedThisWeek = issues.filter((i) => i.status === 'resolved').length;

  return (
    <div className="social" ref={root}>
      <header className="so-top">
        <div className="so-brand">
          <img src="/mamdani-face.png" alt="" />
          <b>
            mamdani<i>.</i>
          </b>
          <span>social</span>
        </div>
        <span className="so-live">
          <i className="live-dot" /> Ottawa
        </span>
      </header>

      <div className="so-stories">
        <div className="story city">
          <span className="story-ring">
            <img src="/mamdani-face.png" alt="" />
          </span>
          <em>City</em>
        </div>
        {PEOPLE.map((p) => (
          <div key={p.handle} className="story">
            <span className="story-ring">
              <span className="av" style={{ background: p.color }}>
                {p.name[0]}
              </span>
            </span>
            <em>{p.name}</em>
          </div>
        ))}
      </div>

      <div className="so-banner">
        <Sparkles size={16} />
        <span>
          <b>{fixedThisWeek}</b> fixed · <b>{issues.filter((i) => i.status !== 'resolved' && i.status !== 'new').length}</b> being handled by the city right now
        </span>
      </div>

      <nav className="so-tabs">
        {(['latest', 'trending', 'fixed'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'latest' ? 'Latest' : t === 'trending' ? 'Most reported' : 'Fixed ✓'}
          </button>
        ))}
      </nav>

      <main className="so-feed">
        {posts.map((i) => {
          const a = author(i);
          const cityReplies = i.events.filter((e) => e.kind === 'status');
          const likes = i.reports - 1 + (liked.has(i.id) ? 1 : 0);
          return (
            <article key={i.id} className="post">
              <div className="post-head">
                <span className="av" style={{ background: a.color }}>
                  {a.name[0]}
                </span>
                <div>
                  <b>{a.name}</b>
                  <span>
                    @{a.handle} · {ago(i.firstReportedAt)}
                  </span>
                </div>
                <StatusLabel status={i.status} />
              </div>

              <div className="post-media">
                {i.mediaId ? (
                  <img src={api.media(i.mediaId)} alt={i.title} loading="lazy" />
                ) : (
                  <img
                    src={`https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/pin-l+ff6a13(${i.lng},${i.lat})/${i.lng},${i.lat},17.4,0,30/640x420@2x?access_token=${import.meta.env.VITE_MAPBOX_ACCESS_TOKEN}&logo=false&attribution=false`}
                    alt={`Map of ${i.address}`}
                    loading="lazy"
                  />
                )}
                <span className="post-cat">
                  <CategoryIcon id={i.category} size={14} /> {category(i.category).label}
                </span>
              </div>

              <div className="post-actions">
                <button
                  className={liked.has(i.id) ? 'on' : ''}
                  onClick={() =>
                    setLiked((s) => {
                      const n = new Set(s);
                      if (n.has(i.id)) n.delete(i.id);
                      else n.add(i.id);
                      return n;
                    })
                  }
                >
                  <Heart size={20} fill={liked.has(i.id) ? 'currentColor' : 'none'} /> Me too
                </button>
                <button>
                  <MessageCircle size={20} /> {cityReplies.length}
                </button>
                <button
                  onClick={() => {
                    const url = `${location.origin}/feed#${i.id}`;
                    void (navigator.share ? navigator.share({ title: i.title, text: i.summary, url }) : navigator.clipboard?.writeText(url));
                  }}
                >
                  <Share2 size={20} />
                </button>
              </div>

              <div className="post-body">
                {likes > 0 && (
                  <p className="post-likes">
                    <b>{likes}</b> {likes === 1 ? 'neighbour' : 'neighbours'} reported this too
                  </p>
                )}
                <p>
                  <b>{a.handle}</b> {i.title}. {i.summary}
                </p>
                <p className="post-where">
                  <MapPin size={13} /> {street(i.address)}
                  {hood(i.address) ? ` · ${hood(i.address)}` : ''}
                </p>
                {cityReplies.length > 0 && (
                  <div className="city-reply">
                    <img src="/mamdani-face.png" alt="" />
                    <div>
                      <b>City of Ottawa</b>
                      <span>
                        {STATUS_SHORT[i.status]} · {i.department.split(' — ')[0]} · {ago(cityReplies[cityReplies.length - 1].at)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </article>
          );
        })}
        {!posts.length && <p className="so-empty">Loading the city…</p>}
      </main>
    </div>
  );
}
