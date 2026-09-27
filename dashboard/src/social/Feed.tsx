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

/** The phone saves the whole conversation; keep what the resident said, short enough for a caption. */
function residentWords(transcript: string) {
  const theirs = [...transcript.matchAll(/Resident:\s*([\s\S]*?)(?=\s*(?:Mamdani|Resident):|$)/g)].map((m) => m[1].trim()).filter(Boolean);
  const text = (theirs.length ? theirs.join(' ') : transcript).replace(/\s+/g, ' ').trim();
  return text.length > 160 ? `${text.slice(0, 157).replace(/\s+\S*$/, '')}…` : text;
}

export function Feed() {
  const [issues, setIssues] = useState<Issue[]>([]);
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

  // only real reports with the resident's photo, newest first
  const posts = useMemo(() => issues.filter((i) => i.mediaId).sort((a, b) => b.firstReportedAt - a.firstReportedAt), [issues]);

  // comments: what residents said when they reported it, plus anything added here
  const [said, setSaid] = useState<Record<number, string[]>>({});
  const [mine, setMine] = useState<Record<number, string[]>>(() => {
    try {
      return JSON.parse(localStorage.getItem('mamdani-social-comments') ?? '{}');
    } catch {
      return {};
    }
  });
  const [draft, setDraft] = useState<Record<number, string>>({});
  useEffect(() => {
    for (const p of posts) {
      if (said[p.id]) continue;
      api
        .issue(p.id)
        .then((r) => setSaid((m) => ({ ...m, [p.id]: r.reports.map((x) => residentWords(x.transcript)).filter(Boolean) })))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts.map((p) => p.id).join()]);
  const comment = (id: number) => {
    const text = (draft[id] ?? '').trim();
    if (!text) return;
    setMine((m) => {
      const next = { ...m, [id]: [...(m[id] ?? []), text] };
      try {
        localStorage.setItem('mamdani-social-comments', JSON.stringify(next));
      } catch {
        /* private window */
      }
      return next;
    });
    setDraft((d) => ({ ...d, [id]: '' }));
  };

  useGSAP(() => {
    gsap.from('.post', { y: 20, opacity: 0, duration: 0.5, stagger: 0.05 });
  }, { scope: root, dependencies: [posts.length > 0] });

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
                <img src={api.media(i.mediaId!)} alt={i.title} loading="lazy" />
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
                <button onClick={() => document.getElementById(`c-${i.id}`)?.focus()}>
                  <MessageCircle size={20} /> {(said[i.id]?.length ?? 0) + (mine[i.id]?.length ?? 0) + cityReplies.length}
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
                  <b>{a.handle}</b> {said[i.id]?.[0] ? `“${said[i.id][0]}”` : i.title}
                </p>
                <p className="post-ai">
                  <Sparkles size={13} /> {i.summary}
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
                <ul className="comments">
                  {(said[i.id] ?? []).slice(1).map((t, k) => {
                    const who = PEOPLE[(i.id + k + 1) % PEOPLE.length];
                    return (
                      <li key={`s${k}`}>
                        <b>{who.handle}</b> {t}
                      </li>
                    );
                  })}
                  {(mine[i.id] ?? []).map((t, k) => (
                    <li key={`m${k}`}>
                      <b>you</b> {t}
                    </li>
                  ))}
                </ul>
                <form
                  className="comment-box"
                  onSubmit={(e) => {
                    e.preventDefault();
                    comment(i.id);
                  }}
                >
                  <input
                    id={`c-${i.id}`}
                    value={draft[i.id] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [i.id]: e.target.value }))}
                    placeholder="Add a comment…"
                  />
                  <button type="submit" disabled={!(draft[i.id] ?? '').trim()}>
                    Post
                  </button>
                </form>
              </div>
            </article>
          );
        })}
        {!posts.length && <p className="so-empty">{issues.length ? 'No photo reports yet.' : 'Loading the city…'}</p>}
      </main>
    </div>
  );
}
