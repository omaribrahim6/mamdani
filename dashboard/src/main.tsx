import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import 'mapbox-gl/dist/mapbox-gl.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/print.css';
import { App } from './App';
import './auth/login.css';

gsap.registerPlugin(useGSAP);
gsap.defaults({ ease: 'power3.out' });

// No sign-in: "/" is the front door, and clicking through opens the portal read-only. AI is off,
// so anyone can look around the project without an account.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
