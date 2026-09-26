import { useAuth0 } from '@auth0/auth0-react';
import { ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';

export function LoginScreen() {
  const { loginWithRedirect } = useAuth0();

  return (
    <main className="login-shell">
      <section className="login-brand">
        <div className="brand-lockup">
          <div className="seal" aria-hidden="true">CW</div>
          <span>Cityworks Command</span>
        </div>
        <div className="login-copy">
          <p className="session-line">Saturday operations · Toronto</p>
          <h1>See what needs the city’s attention next.</h1>
          <p className="login-lede">
            A protected workspace for triaging public reports, assigning crews,
            and keeping urgent accessibility issues moving.
          </p>
        </div>
        <div className="login-footnote">
          <ShieldCheck size={18} /> Secured with Auth0 Universal Login
        </div>
      </section>

      <section className="login-panel">
        <div className="signin-card">
          <p className="signin-label">Staff access</p>
          <h2>Enter the command centre</h2>
          <p>Use your authorized city account. Access is logged for security.</p>
          <button className="primary-button" onClick={() => loginWithRedirect()}>
            Continue to sign in <ArrowRight size={18} />
          </button>
          <ul className="security-list" aria-label="Authentication features">
            <li><CheckCircle2 size={16} /> Redirect-based sign-in</li>
            <li><CheckCircle2 size={16} /> Tokens kept in memory</li>
            <li><CheckCircle2 size={16} /> Automatic session checks</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
