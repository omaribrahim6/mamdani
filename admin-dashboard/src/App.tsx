import { useAuth0 } from '@auth0/auth0-react';
import { Dashboard } from './components/Dashboard';
import { LoginScreen } from './components/LoginScreen';

export default function App() {
  const { isAuthenticated, isLoading, error } = useAuth0();

  if (isLoading) {
    return (
      <main className="auth-state" aria-live="polite">
        <div className="auth-spinner" />
        <p>Checking your credentials…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="auth-state error-state">
        <h1>Sign-in could not be completed</h1>
        <p>{error.message}</p>
        <p>Check the Auth0 callback URL and try again.</p>
      </main>
    );
  }

  return isAuthenticated ? <Dashboard /> : <LoginScreen />;
}
