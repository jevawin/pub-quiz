import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdminRules } from './AdminRules';

const api = vi.hoisted(() => ({ getRules: vi.fn(), addRule: vi.fn(), setRuleActive: vi.fn(), sweepRule: vi.fn() }));
vi.mock('@/lib/adminApi', async () => ({ ...(await vi.importActual<object>('@/lib/adminApi')), ...api }));

beforeEach(() => {
  api.getRules.mockReset().mockResolvedValue([{ id: 7, body: 'No trick questions', exampleQuestionId: null, active: true, createdAt: '2026-10-01T00:00:00Z', lastSweep: null }]);
  api.addRule.mockReset().mockResolvedValue({ id: 8 });
  api.setRuleActive.mockReset().mockResolvedValue({ ok: true });
  api.sweepRule.mockReset().mockResolvedValue({ id: 1 });
});

describe('AdminRules', () => {
  it('sweep now posts rule id', async () => {
    render(<MemoryRouter><AdminRules /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Sweep now' }));
    expect(api.sweepRule).toHaveBeenCalledWith(7);
    expect(await screen.findByText('Queued — applies within 5 min')).toBeInTheDocument();
  });
  it('new rule posts body', async () => {
    render(<MemoryRouter><AdminRules /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'New rule' }));
    await userEvent.type(screen.getByLabelText('Rule'), 'Avoid US-only trivia');
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(api.addRule).toHaveBeenCalledWith('Avoid US-only trivia');
  });
  it('toggle posts active', async () => {
    render(<MemoryRouter><AdminRules /></MemoryRouter>);
    await userEvent.click(await screen.findByLabelText('Active: No trick questions'));
    expect(api.setRuleActive).toHaveBeenCalledWith(7, false);
  });
});
