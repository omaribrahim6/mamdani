import { ArrowLeft, Ban, Check, HardHat, Map as MapIcon, Image as ImageIcon, Play, Users, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { mediaUrl, WRITES_ENABLED, type ApiIssue, type Status } from '../data/api';
import { category } from '../data/categories';
import { ago, clock, STATUS_LABEL, ticketId, tier } from '../data/view';
import { EvidenceCanvas, type Evidence } from '../gl/evidence';
import { useStages } from '../gl/GLProvider';
import { ReportMap } from './ReportMap';

interface ReportDetailProps {
  issue: ApiIssue;
  now: number;
  onClose: () => void;
  onStatus: (status: Status, note: string, burn: boolean) => void;
  onSimulateConfirm: () => void;
}

export function ReportDetail({ issue, now, onClose, onStatus, onSimulateConfirm }: ReportDetailProps) {
  const { back } = useStages();
  const photo = mediaUrl(issue.mediaId);
  const [view, setView] = useState<'photo' | 'map'>(photo ? 'photo' : 'map');
  const host = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const evidence = useRef<Evidence | null>(null);
  const cat = category(issue.category);

  useEffect(() => { setView(photo ? 'photo' : 'map'); }, [issue.id, photo]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const boxKey = issue.box ? issue.box.join(",") : "";
  useEffect(() => {
    if (!back || !host.current || !canvas.current || view !== 'photo') return;
    let ec: EvidenceCanvas;
    try { ec = new EvidenceCanvas(host.current, canvas.current); } catch { return; }
    evidence.current = ec.view;
    ec.view.show(photo, boxKey ? (boxKey.split(",").map(Number) as [number, number, number, number]) : null, cat.color);
    return () => { ec.dispose(); evidence.current = null; };
  }, [back, view, issue.id, photo, boxKey, cat.color]);


  const act = (status: Status, note: string, burn = false) => onStatus(status, note, burn);
  const t = tier(issue);

  return (
    <article className="report-detail" aria-labelledby="detail-title" style={{ ['--tone' as string]: cat.color }}>
      <header className="detail-header">
        <button type="button" className="back-button" onClick={onClose}><ArrowLeft size={16} /> Queue</button>
        <div className="detail-id"><span className={`priority-dot priority-${t.toLowerCase()}`} />{ticketId(issue)}<small>priority {issue.priority}</small></div>
        <button type="button" className="close-button" onClick={onClose} aria-label="Close report detail"><X size={18} /></button>
      </header>

      <div className="detail-scroll" ref={scroll}>
        <section className="viewer-layout" aria-label="Evidence and location">
          <div className="main-viewer">
            {view === 'photo' && photo ? (
              <div ref={host} className="evidence-host" role="img" aria-label={`Resident photo: ${issue.title}. Gemini marked the problem area.`}>
                {back ? <canvas ref={canvas} className="evidence-canvas" /> : <img src={photo} alt="" />}
                <span className="evidence-tag" style={{ borderColor: cat.color }}>{cat.label} · Gemini detection</span>
              </div>
            ) : (
              <ReportMap coordinates={[issue.lng, issue.lat]} label={issue.address} color={cat.color} />
            )}
            <span className="viewer-label">{view === 'photo' ? 'Evidence · faces and plates blurred' : '3D location'}</span>
          </div>
          <div className="media-rail" aria-label="Choose photo or map">
            {photo && (
              <button type="button" className={view === 'photo' ? 'media-option active' : 'media-option'} onClick={() => setView('photo')} aria-pressed={view === 'photo'}>
                <ImageIcon size={19} /><span>Photo</span>
              </button>
            )}
            <button type="button" className={view === 'map' ? 'media-option active' : 'media-option'} onClick={() => setView('map')} aria-pressed={view === 'map'}>
              <MapIcon size={19} /><span>Map</span>
            </button>
          </div>
        </section>

        <section className="detail-content">
          <div className="detail-title-block">
            <div className="detail-badges"><span className="badge-tone">{cat.label}</span><span>{STATUS_LABEL[issue.status]}</span>{issue.accessibility.barrier && <span className="badge-a11y">Accessibility barrier</span>}</div>
            <h2 id="detail-title">{issue.title}</h2>
            <p className="detail-address">{issue.address}</p>
          </div>

          <div className="action-bar" role="group" aria-label="Update this ticket">
            {issue.status === 'new' && <button type="button" onClick={() => act('assigned', 'Crew assigned')}><HardHat size={15} /> Assign crew</button>}
            {issue.status === 'assigned' && <button type="button" onClick={() => act('in_progress', 'Crew on site')}><Play size={15} /> Crew on site</button>}
            {issue.status !== 'resolved' && <button type="button" className="primary" onClick={() => act('resolved', 'Fixed and verified', true)}><Check size={15} /> Mark resolved</button>}
            {issue.status !== 'resolved' && <button type="button" className="ghost" onClick={() => act('resolved', 'Closed: false positive', true)}><Ban size={15} /> False positive</button>}
            {issue.status === 'resolved' && <button type="button" onClick={() => act('assigned', 'Reopened')}><HardHat size={15} /> Reopen</button>}
            <button type="button" className="ghost" onClick={onSimulateConfirm} title="Demo: another resident reports the same problem"><Users size={15} /> Simulate duplicate</button>
          </div>
          {!WRITES_ENABLED && <p className="preview-note">Preview mode: status changes stay in this browser and are not written to the city's record.</p>}

          {issue.standard ? (
            <div className={`gc-notice${issue.dueAt && issue.dueAt < now && issue.status !== 'resolved' ? ' danger' : ''}`} role="note">
              <h3>City service standard{issue.dueAt ? ` · due ${clock(issue.dueAt)}` : ''}</h3>
              <p>{issue.standard.text} <a href={issue.standard.sourceUrl} target="_blank" rel="noreferrer">{issue.standard.sourceTitle}</a></p>
            </div>
          ) : (
            <div className="gc-notice" role="note"><h3>City service standard</h3><p>No published target for this category yet. Triage by priority.</p></div>
          )}
          {issue.accessibility.barrier && (
            <div className="gc-notice warning" role="note"><h3>Accessibility barrier</h3><p>{issue.accessibility.notes[0] ?? 'Blocks people using mobility aids.'}</p></div>
          )}

          <div className="report-facts">
            <div><span>First reported</span><strong>{clock(issue.firstReportedAt)}</strong></div>
            <div data-reports-target={issue.id}><span>Residents reporting</span><strong>{issue.reports}</strong></div>
            <div><span>Department</span><strong>{issue.department}</strong></div>
            <div><span>Last update</span><strong>{ago(issue.updatedAt, now)}</strong></div>
            {issue.dueAt ? <div><span>City target</span><strong>{clock(issue.dueAt)}</strong></div> : null}
          </div>

          <div className="priority-bars" aria-label="Why this priority">
            {Object.entries(issue.priorityParts).map(([k, v]) => (
              <div key={k}><span>{k}</span><i style={{ width: `${Math.min(100, v * 3)}%` }} /><b>{v}</b></div>
            ))}
          </div>

          <div className="report-narrative"><h3>What residents saw</h3><p>{issue.summary}</p>
            {issue.accessibility.notes.length > 0 && <ul>{issue.accessibility.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          </div>

          <ol className="event-log">
            {[...issue.events].reverse().map((e, i) => <li key={i}><time>{clock(e.at)}</time>{e.note}</li>)}
          </ol>
        </section>
      </div>
    </article>
  );
}
