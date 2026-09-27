import { createRoot } from 'react-dom/client';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../styles/base.css';
import '../styles/shell.css';
import '../styles/print.css';
import { Dashboard } from '../App';
import { navigate } from '../lib/router';

// Dev only (served by `npm run dev`, never built): the real dashboard without the Auth0 gate, on the
// live map, so "Send Mamdani" can be tried and recorded without signing in. Open /dive.html.
gsap.registerPlugin(useGSAP);
gsap.defaults({ ease: 'power3.out' });
navigate('/admin/map', true);
createRoot(document.getElementById('root')!).render(<Dashboard />);
