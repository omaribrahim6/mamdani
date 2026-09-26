import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import { LoginScreen } from './LoginScreen';

vi.mock('mapbox-gl', () => {
  class MapMock {
    addControl() {}
    resize() {}
    remove() {}
  }
  class MarkerMock {
    setLngLat() { return this; }
    addTo() { return this; }
  }
  return { default: { Map: MapMock, Marker: MarkerMock, NavigationControl: class {}, AttributionControl: class {}, accessToken: '' } };
});

const auth = vi.hoisted(() => ({
  loginWithRedirect: vi.fn(),
  logout: vi.fn(),
  user: { name: 'Alex Rivera', email: 'alex@example.ca' },
}));

vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => auth }));

afterEach(() => cleanup());

describe('authenticated report workspace', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens a report, switches reports, and closes with Escape', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByRole('button', { name: /Open report CW-2418/i }));
    expect(screen.getByRole('heading', { name: 'Sidewalk uplift blocking curb access' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open report CW-2413/i }));
    expect(screen.getByRole('heading', { name: 'Pedestrian signal remains dark' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Close report detail' })).not.toBeInTheDocument();
  });

  it('switches from the map to a photo and back to the map', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByRole('button', { name: /Open report CW-2418/i }));
    const photoButton = screen.getByRole('button', { name: /Show photo 1/i });
    fireEvent.click(photoButton);
    expect(screen.getByAltText('Raised concrete sidewalk panels beside a city street')).toBeInTheDocument();
    expect(photoButton).toHaveAttribute('aria-pressed', 'true');
    const mapButton = screen.getByRole('button', { name: 'Show map' });
    fireEvent.click(mapButton);
    expect(mapButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(/3D map showing Dundas St W/i)).toBeInTheDocument();
  });

  it('keeps Auth0 logout behavior wired to the staff control', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.logout).toHaveBeenCalledWith({ logoutParams: { returnTo: window.location.origin } });
  });
});

describe('login screen', () => {
  it('starts Auth0 redirect login from the primary action', () => {
    render(<LoginScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Continue to sign in/i }));
    expect(auth.loginWithRedirect).toHaveBeenCalledOnce();
  });
});
