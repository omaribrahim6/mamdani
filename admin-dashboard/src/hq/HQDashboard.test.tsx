import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HQDashboard } from './HQDashboard';

vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ user: { name: 'Andy Han' }, logout: vi.fn() }) }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('City Command HQ', () => {
  it('shows the health score, briefing, leaderboard and field quests from the snapshot', async () => {
    render(<HQDashboard />);
    expect(await screen.findByLabelText(/City Health Score \d+ percent/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /AI Daily Operations Briefing/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /District Leaderboard/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Field Quests/ })).toBeInTheDocument();
  });

  it('awards XP when a quest is cleared', async () => {
    render(<HQDashboard />);
    const buttons = await screen.findAllByRole('button', { name: /False positive/ });
    fireEvent.click(buttons[0]);
    expect(await screen.findByText('20 XP')).toBeInTheDocument();
  });

  it('filters with a plain-language query', async () => {
    render(<HQDashboard />);
    await screen.findAllByRole('button', { name: /False positive/ });
    fireEvent.change(screen.getByLabelText('Query city data'), { target: { value: 'open potholes' } });
    expect(await screen.findByText(/\d+ found/)).toBeInTheDocument();
  });
});
