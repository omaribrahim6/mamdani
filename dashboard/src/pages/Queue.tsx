import { useState } from 'react';
import { Search } from 'lucide-react';
import { useCity } from '../lib/city';
import { QueueTable } from '../components/QueueTable';
import './pages.css';

export default function QueuePage() {
  const city = useCity();
  const [q, setQ] = useState('');
  return (
    <div className="page">
      <section className="phead">
        <div>
          <h1>Work queue</h1>
          <p>Every issue residents reported, ranked by an explainable priority. Select several to act on them together or plan a crew run.</p>
        </div>
        <div className="phead-actions">
          <label className="field">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by street, number, type…" />
          </label>
        </div>
      </section>
      <section className="card">
        <QueueTable issues={city.issues} selectable query={q} />
      </section>
    </div>
  );
}
