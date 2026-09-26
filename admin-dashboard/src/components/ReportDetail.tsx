import { ArrowLeft, CameraOff, Map as MapIcon, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReportViewModel } from '../types';
import { ReportMap } from './ReportMap';

interface ReportDetailProps {
  report: ReportViewModel;
  onClose: () => void;
}

export function ReportDetail({ report, onClose }: ReportDetailProps) {
  const [activeMediaId, setActiveMediaId] = useState<string | null>(null);
  const [failedMedia, setFailedMedia] = useState<string[]>([]);
  const activeMedia = report.media.find((media) => media.id === activeMediaId);

  useEffect(() => {
    setActiveMediaId(null);
    setFailedMedia([]);
  }, [report.id]);

  return (
    <article className="report-detail" aria-labelledby="detail-title">
      <header className="detail-header">
        <button type="button" className="back-button" onClick={onClose}><ArrowLeft size={17} /> Back to reports</button>
        <div className="detail-id"><span className={`priority-dot priority-${report.priority.toLowerCase()}`} />{report.id}</div>
        <button type="button" className="close-button" onClick={onClose} aria-label="Close report detail"><X size={18} /></button>
      </header>

      <div className="detail-scroll">
        <section className="viewer-layout" aria-label="Report location and media">
          <div className="main-viewer">
            {activeMedia ? (
              failedMedia.includes(activeMedia.id) ? (
                <div className="photo-fallback" role="status"><CameraOff size={28} /><strong>Photo unavailable</strong><p>The report remains available without this image.</p></div>
              ) : (
                <img src={activeMedia.imageUrl} alt={activeMedia.alt} onError={() => setFailedMedia((items) => [...items, activeMedia.id])} />
              )
            ) : <ReportMap coordinates={report.coordinates} label={report.address} />}
            <span className="viewer-label">{activeMedia ? 'Field photo' : '3D location'}</span>
          </div>

          <div className="media-rail" aria-label="Choose map or photo">
            <button type="button" className={!activeMedia ? 'media-option active' : 'media-option'} onClick={() => setActiveMediaId(null)} aria-pressed={!activeMedia} aria-label="Show map">
              <MapIcon size={21} /><span>Map</span>
            </button>
            {report.media.map((media, index) => (
              <button type="button" key={media.id} className={activeMediaId === media.id ? 'media-option active' : 'media-option'} onClick={() => setActiveMediaId(media.id)} aria-pressed={activeMediaId === media.id} aria-label={`Show photo ${index + 1}: ${media.alt}`}>
                {failedMedia.includes(media.id) ? <CameraOff size={19} /> : <img src={media.imageUrl} alt="" onError={() => setFailedMedia((items) => [...items, media.id])} />}
                <span>Photo {index + 1}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="detail-content">
          <div className="detail-title-block">
            <div className="detail-badges"><span>{report.category}</span><span>{report.status}</span></div>
            <h2 id="detail-title">{report.title}</h2>
            <p className="detail-address">{report.address}</p>
          </div>
          <div className="report-facts">
            <div><span>Reported</span><strong>{report.reportedAt}</strong></div>
            {report.details.map((detail) => <div key={detail.label}><span>{detail.label}</span><strong>{detail.value}</strong></div>)}
          </div>
          <div className="report-narrative"><h3>Report notes</h3><p>{report.summary}</p></div>
        </section>
      </div>
    </article>
  );
}
