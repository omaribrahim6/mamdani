import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';
import App from './App';
import '@fontsource-variable/manrope';
import './styles.css';
import './command.css';
import { GLProvider } from './gl/GLProvider';

const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;

const root = createRoot(document.getElementById('root')!);

root.render(
  <StrictMode>
    <GLProvider>
    {domain && clientId ? (
      <Auth0Provider
        domain={domain}
        clientId={clientId}
        authorizationParams={{ redirect_uri: window.location.origin }}
        cacheLocation="memory"
      >
        <App />
      </Auth0Provider>
    ) : (
      <main className="configuration-page">
        <div className="seal" aria-hidden="true">CW</div>
        <p className="configuration-kicker">Cityworks Command</p>
        <h1>Connect Auth0 to open the operations desk.</h1>
        <p>
          Copy <code>.env.example</code> to <code>.env</code>, then add your Auth0
          domain and client ID. Restart the development server when you’re done.
        </p>
      </main>
    )}
    </GLProvider>
  </StrictMode>,
);
