import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import 'mapbox-gl/dist/mapbox-gl.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/print.css';
import { Auth0Provider } from '@auth0/auth0-react';
import { App } from './App';
import { navigate } from './lib/router';
import './auth/login.css';

gsap.registerPlugin(useGSAP);
gsap.defaults({ ease: 'power3.out' });

// City staff sign in with Auth0 (the admin branch's tenant and app). Auth0 sends them back to
// "/", then onRedirectCallback takes them where they were going (default /admin/).
const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {domain && clientId ? (
      <Auth0Provider
        domain={domain}
        clientId={clientId}
        authorizationParams={{ redirect_uri: location.origin }}
        cacheLocation="localstorage"
        onRedirectCallback={(state) => {
          try {
            sessionStorage.removeItem('mamdani-return');
          } catch {
            /* private window */
          }
          navigate((state as { returnTo?: string } | undefined)?.returnTo ?? '/admin/', true);
        }}
      >
        <App />
      </Auth0Provider>
    ) : (
      <div className="login lg-checking">
        <img src="/mamdani-face.png" alt="" />
        <p>
          Add <code>VITE_AUTH0_DOMAIN</code> and <code>VITE_AUTH0_CLIENT_ID</code> to <code>dashboard/.env</code> to open Command.
        </p>
      </div>
    )}
  </StrictMode>,
);
