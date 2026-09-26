import { useAuth0 } from '@auth0/auth0-react';
import { ArrowUpRight, Camera, MapPin } from 'lucide-react';
import { Auth0Mark, BrandMark } from './BrandMark';

export function LoginScreen() {
  const { loginWithRedirect } = useAuth0();

  return (
    <main className="login-page">
      <div className="login-console">
        <header className="login-header">
          <BrandMark />
        </header>

        <section className="login-hero">
          <div className="login-message">
            <h1>Every report.<br />One clear response.</h1>
            <p>Review public-space issues, verify their location, and give field teams the context they need to act.</p>
            <button type="button" onClick={() => loginWithRedirect()}>
              Continue to sign in <ArrowUpRight size={19} />
            </button>
          </div>

          <div className="login-preview" aria-hidden="true">
            <div className="preview-map">
              <div className="preview-streets"><i /><i /><i /><i /></div>
              <span className="preview-pin"><MapPin size={19} /></span>
              <div className="map-caption"><span>Live location</span><strong>43.6496, −79.4349</strong></div>
            </div>
            <div className="preview-report">
              <div><span className="priority-tag priority-urgent">Urgent</span><small>CW-2418</small></div>
              <h2>Sidewalk uplift blocking curb access</h2>
              <p>Dundas St W & Gladstone Ave</p>
              <footer><span>Accessibility</span><span><Camera size={14} /> 2 photos</span></footer>
            </div>
          </div>
        </section>

        <footer className="login-footer"><span><Auth0Mark /> Secured by Auth0</span></footer>
      </div>
    </main>
  );
}
