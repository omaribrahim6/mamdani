import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../styles/base.css';
import '../styles/shell.css';
import '../styles/print.css';
import { Dashboard } from '../App';
import { navigate } from '../lib/router';
import { Dive } from '../mamdani/Dive';
import { sendMamdani } from '../mamdani/diveStore';

// Dev only (served by `npm run dev`, never built): the film set for the "Mamdani dives into the
// map" video. The real dashboard on the live map; the dive starts on its own once the map has
// settled (or from window.__go()). Open /dive.html.
gsap.registerPlugin(useGSAP);
gsap.defaults({ ease: 'power3.out' });
// read the options before the URL moves to the map page
const query = new URLSearchParams(location.search);
navigate('/admin/map', true);

function Auto() {
  useEffect(() => {
    Object.assign(globalThis, { __go: sendMamdani });
    if (!query.has('manual')) {
      const t = setTimeout(sendMamdani, Number(query.get('delay') ?? 4500));
      return () => clearTimeout(t);
    }
  }, []);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <Dashboard>
    <Dive />
    <Auto />
  </Dashboard>,
);
