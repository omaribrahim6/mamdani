import { useAuth0 } from '@auth0/auth0-react';
import { ArrowRight } from 'lucide-react';
import { useLang } from '../i18n';
import { Auth0Mark } from './BrandMark';
import { GcFooter, GcHeader } from './GcChrome';

export function LoginScreen() {
  const { loginWithRedirect } = useAuth0();
  const { lang } = useLang();
  const fr = lang === 'fr';

  return (
    <div className="login-page">
      <GcHeader />
      <main className="login-body" id="main">
        <h1>{fr ? 'Chaque signalement. Une réponse claire.' : 'Every report. One clear response.'}</h1>
        <p>
          {fr
            ? 'Triez les signalements des résidents, vérifiez le lieu sur le jumeau numérique du centre-ville et donnez aux équipes le contexte nécessaire pour agir.'
            : 'Triage what residents report, verify it on the downtown digital twin, and give field crews the context they need to act.'}
        </p>
        <div>
          <button type="button" onClick={() => loginWithRedirect()}>
            {fr ? 'Se connecter avec le compte municipal' : 'Sign in with your City account'} <ArrowRight size={18} aria-hidden="true" />
          </button>
          <small><Auth0Mark /> {fr ? 'Authentification sécurisée par Auth0' : 'Secured by Auth0'}</small>
        </div>
      </main>
      <GcFooter />
    </div>
  );
}
