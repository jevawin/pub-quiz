import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdminSweeps } from './AdminSweeps';

const api = vi.hoisted(() => ({ getSweeps: vi.fn(), keepProposals: vi.fn() }));
vi.mock('@/lib/adminApi', async () => ({ ...(await vi.importActual<object>('@/lib/adminApi')), ...api }));

const prop = (id: string, extra = {}) => ({ questionId: id, text: `Q ${id}`, answer: 'x', reason: 'bad', keptAt: null, appliedAt: null, ...extra });

const SW = {
    id: 3, status: 'proposed', total: 100, judged: 100, proposed: 3, executeAfter: new Date(Date.now() + 5 * 3600e3).toISOString(),
    createdAt: '2026-10-30T00:00:00Z', ruleId: 7, ruleBody: 'No trick questions', noticeSentAt: null,
    proposals: [prop('a'), prop('b'), prop('c', { appliedAt: '2026-10-30T01:00:00Z' })],
};

beforeEach(() => {
  api.getSweeps.mockReset().mockResolvedValue([SW]);
  api.keepProposals.mockReset().mockResolvedValue({ kept: 1 });
});

describe('AdminSweeps', () => {
  it('keep posts selected ids', async () => {
    render(<MemoryRouter><AdminSweeps /></MemoryRouter>);
    await userEvent.click(await screen.findByLabelText('Keep Q b'));
    await userEvent.click(screen.getByRole('button', { name: 'Keep selected' }));
    expect(api.keepProposals).toHaveBeenCalledWith(3, ['b']);
  });
  it('applied proposals cannot be kept and countdown shows', async () => {
    api.getSweeps.mockResolvedValue([{ ...SW, noticeSentAt: '2026-10-30T00:00:00Z' }]);
    render(<MemoryRouter><AdminSweeps /></MemoryRouter>);
    expect(await screen.findByLabelText('Keep Q c')).toBeDisabled();
    expect(screen.getByText(/hidden in 4h|hidden in 5h/)).toBeInTheDocument();
  });
  it('says awaiting notice when no notice was sent', async () => {
    render(<MemoryRouter><AdminSweeps /></MemoryRouter>);
    expect(await screen.findByText('awaiting notice')).toBeInTheDocument();
    expect(screen.queryByText(/hidden in/)).toBeNull();
  });
});
