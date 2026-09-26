import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import { LoginScreen } from './LoginScreen';

vi.mock('mapbox-gl', () => {
  class MapMock {
    addControl() {}
    resize() {}
    remove() {}
    on() {}
  }
  class MarkerMock {
    setLngLat() { return this; }
    addTo() { return this; }
  }
  return { default: { Map: MapMock, Marker: MarkerMock, NavigationControl: class {}, AttributionControl: class {}, MercatorCoordinate: { fromLngLat: () => ({ x: 0, y: 0, meterInMercatorCoordinateUnits: () => 1 }) }, accessToken: '' } };
});

const auth = vi.hoisted(() => ({
  loginWithRedirect: vi.fn(),
  logout: vi.fn(),
  user: { name: 'Alex Rivera', email: 'alex@example.ca' },
}));

vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => auth }));

// no network in tests: the dashboard falls back to its Ottawa snapshot
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline')))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('authenticated report workspace', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens a ticket from the queue and closes it with Escape', async () => {
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /Open OTT-1832/i }));
    expect(screen.getByRole('heading', { name: 'Heaved slab blocks the sidewalk' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Update this ticket' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Close report detail' })).not.toBeInTheDocument();
  });

  it('switches between the evidence photo and the map', async () => {
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /Open OTT-1831/i }));
    const mapButton = screen.getByRole('button', { name: /Map/ });
    fireEvent.click(mapButton);
    expect(mapButton).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Photo/ }));
    expect(screen.getByRole('img', { name: /Resident photo/ })).toBeInTheDocument();
  });

  it('resolves a ticket locally in preview mode', async () => {
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /Open OTT-1832/i }));
    fireEvent.click(screen.getByRole('button', { name: /Mark resolved/ }));
    fireEvent.click(await screen.findByRole('tab', { name: 'resolved' }));
    expect(await screen.findByRole('button', { name: /Open OTT-1832/i })).toBeInTheDocument();
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
