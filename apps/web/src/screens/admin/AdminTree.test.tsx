import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdminTree } from './AdminTree';
import type { AdminCategory } from '@/lib/adminApi';

const api = vi.hoisted(() => ({
  getTree: vi.fn(),
  requestAction: vi.fn(),
  addFlag: vi.fn(),
}));

vi.mock('@/lib/adminApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/adminApi')>('@/lib/adminApi');
  return { ...actual, ...api };
});

const cat = (o: Partial<AdminCategory> & { id: string; slug: string; name: string }): AdminCategory => ({
  parentId: null, depth: 0, count: 0, hidden: false, hiddenReason: null, protected: false, flagged: false, notes: 0, ...o,
});

const TREE: AdminCategory[] = [
  cat({ id: 'a', slug: 'science', name: 'Science', count: 40 }),
  cat({ id: 'b', slug: 'history', name: 'History', count: 30 }),
  cat({ id: 'c', slug: 'general-knowledge', name: 'General Knowledge', count: 9 }),
  cat({ id: 'a1', slug: 'physics', name: 'Physics', parentId: 'a', depth: 1, count: 12 }),
  cat({ id: 'a2', slug: 'quantum', name: 'Quantum', parentId: 'a1', depth: 2, count: 5 }),
  cat({ id: 'a3', slug: 'entanglement', name: 'Entanglement', parentId: 'a2', depth: 3, count: 2 }),
];

beforeEach(() => {
  api.getTree.mockReset().mockResolvedValue(TREE);
  api.requestAction.mockReset().mockResolvedValue({ id: 1 });
  api.addFlag.mockReset().mockResolvedValue({ ok: true });
});

async function selectTwo() {
  const search = screen.getByLabelText('Search categories');
  await userEvent.type(search, 'physics');
  await userEvent.click(screen.getByRole('button', { name: 'Select' }));
  await userEvent.click(await screen.findByLabelText('Select Physics'));
  await userEvent.clear(search);
  await userEvent.type(search, 'quantum');
  await userEvent.click(await screen.findByLabelText('Select Quantum'));
}

const renderTree = () => render(<MemoryRouter><AdminTree /></MemoryRouter>);

describe('AdminTree', () => {
  it('shows counts at every level', async () => {
    renderTree();
    const row = (await screen.findByText('Science')).closest('li')!;
    expect(within(row).getByLabelText('40 questions')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search categories'), 'quantum');
    const q = (await screen.findByText('Quantum')).closest('li')!;
    expect(within(q).getByLabelText('5 questions')).toBeInTheDocument();
  });

  it('search finds a depth-3 category', async () => {
    renderTree();
    await screen.findByText('Science');
    await userEvent.type(screen.getByLabelText('Search categories'), 'entangle');
    const row = (await screen.findByText('Entanglement')).closest('li')!;
    expect(within(row).getByText('Science › Physics › Quantum')).toBeInTheDocument();
    expect(screen.queryByText('History')).not.toBeInTheDocument();
  });

  it('multi-select drop sends selected slugs', async () => {
    renderTree();
    await screen.findByText('Science');
    await selectTwo();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Drop' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.requestAction).toHaveBeenCalledWith('drop', ['physics', 'quantum']));
    expect(await screen.findByText('Queued — applies within 5 min')).toBeInTheDocument();
  });

  it('confirm text names the count', async () => {
    renderTree();
    await screen.findByText('Science');
    await selectTwo();
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(screen.getByText('Merge 2 into their parents')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Drop' }));
    expect(screen.getByText('Drop 2 categories; questions with no other home are hidden')).toBeInTheDocument();
  });

  it('disables merge and drop for general-knowledge', async () => {
    renderTree();
    await screen.findByText('Science');
    await userEvent.click(screen.getByRole('button', { name: 'Select' }));
    await userEvent.click(screen.getByLabelText('Select General Knowledge'));
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Drop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Flag' })).toBeEnabled();
  });

  it('disables merge and drop for a root category', async () => {
    renderTree();
    await screen.findByText('Science');
    await userEvent.click(screen.getByRole('button', { name: 'Select' }));
    await userEvent.click(screen.getByLabelText('Select Science'));
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Drop' })).toBeDisabled();
  });

  it('401 shows sign-in message', async () => {
    const { AuthError } = await import('@/lib/adminApi');
    api.getTree.mockRejectedValue(new AuthError());
    renderTree();
    expect(await screen.findByText('Not signed in — open /admin again')).toBeInTheDocument();
  });

  it('a dropped category shows Undo guidance instead of Unhide (finding 1)', async () => {
    api.getTree.mockResolvedValue([...TREE, cat({ id: 'z', slug: 'zoology', name: 'Zoology', hidden: true, hiddenReason: 'dropped' }), cat({ id: 'y', slug: 'yachts', name: 'Yachts', hidden: true, hiddenReason: 'veto' })]);
    renderTree();
    await screen.findByText('Science');
    await userEvent.click(screen.getByLabelText('Show hidden'));
    const z = (await screen.findByText('Zoology')).closest('li')!;
    expect(within(z).queryByRole('button', { name: 'Unhide' })).toBeNull();
    expect(within(z).getByText('Undo the drop in Recent changes')).toBeInTheDocument();
    const y = screen.getByText('Yachts').closest('li')!;
    expect(within(y).getByRole('button', { name: 'Unhide' })).toBeInTheDocument();
  });
});
