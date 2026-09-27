import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import 'mapbox-gl/dist/mapbox-gl.css';
import './styles/base.css';
import './styles/shell.css';
import { App } from './App';

gsap.registerPlugin(useGSAP);
gsap.defaults({ ease: 'power3.out' });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
