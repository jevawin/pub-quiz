import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdminChanges } from './AdminChanges';

const api = vi.hoisted(() => ({ getChanges: vi.fn(), undoRun: vi.fn(), getTree: vi.fn(), getHiddenQuestions: vi.fn(), unhideQuestion: vi.fn(), requestAction: vi.fn(), getRequests: vi.fn() }));
vi.mock('@/lib/adminApi', async () => ({ ...(await vi.importActual<object>('@/lib/adminApi')), ...api }));

beforeEach(() => {
  api.getChanges.mockReset().mockResolvedValue([
    { runId: 'r1', at: '2026-10-30T10:00:00Z', actions: [{ action: 'merge', summary: 'Merged A into B' }], undone: false },
    { runId: 'r2', at: '2026-10-29T10:00:00Z', actions: [{ action: 'drop', summary: 'Dropped C' }], undone: true },
  ]);
  api.undoRun.mockReset().mockResolvedValue({ id: 1 });
  api.getTree.mockReset().mockResolvedValue([]);
  api.getHiddenQuestions.mockReset().mockResolvedValue([]);
  api.unhideQuestion.mockReset().mockResolvedValue({ ok: true, runId: 'x' });
  api.requestAction.mockReset().mockResolvedValue({ id: 1 });
  api.getRequests.mockReset().mockResolvedValue([]);
});

describe('AdminChanges', () => {
  it('undo posts the run id', async () => {
    render(<MemoryRouter><AdminChanges /></MemoryRouter>);
    await screen.findByText('Merged A into B');
    await userEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
    expect(api.undoRun).toHaveBeenCalledWith('r1');
    expect(await screen.findByText('Queued — applies within 5 min')).toBeInTheDocument();
  });
  it('undone run shows no Undo', async () => {
    render(<MemoryRouter><AdminChanges /></MemoryRouter>);
    await screen.findByText('Dropped C');
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
    expect(screen.getByText('Undone')).toBeInTheDocument();
  });
  it('hidden tab unhides a category', async () => {
    api.getTree.mockResolvedValue([{ id: 'h', slug: 'old', name: 'Old', parentId: null, depth: 0, count: 1, hidden: true, hiddenReason: 'thin', protected: false, flagged: false, notes: 0 }]);
    render(<MemoryRouter><AdminChanges /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('tab', { name: 'Hidden' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Unhide Old' }));
    expect(api.requestAction).toHaveBeenCalledWith('unhide', ['old']);
  });
  it('hidden questions show unhide only for owner/rule hides', async () => {
    api.getHiddenQuestions.mockResolvedValue([
      { id: 'q1', text: 'Owner one', answer: 'a', parkedReason: 'owner: meh' },
      { id: 'q2', text: 'Rule one', answer: 'a', parkedReason: 'rule 7' },
      { id: 'q3', text: 'Dropped one', answer: 'a', parkedReason: 'owner: dropped' },
      { id: 'q4', text: 'Other one', answer: 'a', parkedReason: 'dedup' },
    ]);
    render(<MemoryRouter><AdminChanges /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('tab', { name: 'Hidden' }));
    await screen.findByText('Dropped one');
    expect(screen.getByRole('button', { name: 'Unhide Owner one' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unhide Rule one' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unhide Dropped one' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unhide Other one' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Unhide Rule one' }));
    expect(api.unhideQuestion).toHaveBeenCalledWith('q2');
  });

  it('dropped and merged categories offer Undo guidance, not Unhide (finding 1)', async () => {
    const c = (id: string, name: string, hiddenReason: string) => ({ id, slug: id, name, parentId: null, depth: 1, count: 0, hidden: true, hiddenReason, protected: false, flagged: false, notes: 0 });
    api.getTree.mockResolvedValue([c('d', 'Dropped cat', 'dropped'), c('m', 'Merged cat', 'merged'), c('t', 'Trimmed cat', 'trimmed')]);
    render(<MemoryRouter><AdminChanges /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('tab', { name: 'Hidden' }));
    await screen.findByText('Dropped cat');
    expect(screen.queryByRole('button', { name: 'Unhide Dropped cat' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unhide Merged cat' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Unhide Trimmed cat' })).toBeInTheDocument();
    expect(screen.getByText('Undo the drop in Recent changes')).toBeInTheDocument();
    expect(screen.getByText('Undo the merge in Recent changes')).toBeInTheDocument();
    expect(screen.getByText(/come back when the drop is undone/)).toBeInTheDocument();
    expect(screen.queryByText(/when that category is unhidden/)).toBeNull();
  });
  it('single-question unhide says Unhidden, not Queued (finding 9)', async () => {
    api.getHiddenQuestions.mockResolvedValue([{ id: 'q1', text: 'Owner one', answer: 'a', parkedReason: 'owner: meh' }]);
    render(<MemoryRouter><AdminChanges /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('tab', { name: 'Hidden' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Unhide Owner one' }));
    expect(await screen.findByText('Unhidden')).toBeInTheDocument();
    expect(screen.queryByText('Queued — applies within 5 min')).toBeNull();
  });
  it('shows pending and failed requests (finding 4)', async () => {
    api.getRequests.mockResolvedValue([
      { id: 3, action: 'unhide', payload: { slugs: ['c'] }, status: 'failed', result: 'c: use Undo on the drop run', createdAt: '2026-10-30T10:00:00Z', doneAt: '2026-10-30T10:05:00Z' },
      { id: 2, action: 'merge', payload: { slugs: ['b'] }, status: 'queued', result: null, createdAt: '2026-10-30T09:00:00Z', doneAt: null },
      { id: 1, action: 'drop', payload: { slugs: ['a'] }, status: 'done', result: 'dropped 1', createdAt: '2026-10-30T08:00:00Z', doneAt: '2026-10-30T08:05:00Z' },
    ]);
    render(<MemoryRouter><AdminChanges /></MemoryRouter>);
    const section = (await screen.findByRole('heading', { name: 'Pending / failed requests' })).closest('section')!;
    expect(section).toHaveTextContent('Unhide c');
    expect(section).toHaveTextContent('failed');
    expect(section).toHaveTextContent('c: use Undo on the drop run');
    expect(section).toHaveTextContent('Merge b');
    expect(section).toHaveTextContent('queued');
    expect(section).not.toHaveTextContent('Drop a');
  });
});
