import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminCategory } from './AdminCategory';
import type { AdminCategory as Cat } from '@/lib/adminApi';

const api = vi.hoisted(() => ({
  getTree: vi.fn(),
  getCategoryQuestions: vi.fn(),
  hideQuestion: vi.fn(),
  addRule: vi.fn(),
  addNote: vi.fn(),
  unhideQuestion: vi.fn(),
  requestAction: vi.fn(),
  addFlag: vi.fn(),
}));

vi.mock('@/lib/adminApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/adminApi')>('@/lib/adminApi');
  return { ...actual, ...api };
});

const cat = (o: Partial<Cat> & { id: string; slug: string; name: string }): Cat => ({
  parentId: null, depth: 0, count: 0, hidden: false, hiddenReason: null, protected: false, flagged: false, notes: 0, ...o,
});

const QID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getTree.mockResolvedValue([
    cat({ id: 'a', slug: 'science', name: 'Science', count: 40 }),
    cat({ id: 'a1', slug: 'physics', name: 'Physics', parentId: 'a', depth: 1, count: 12 }),
    cat({ id: 'a2', slug: 'optics', name: 'Optics', parentId: 'a1', depth: 2, count: 3, hidden: true, hiddenReason: 'dupe' }),
  ]);
  api.getCategoryQuestions.mockResolvedValue([
    { id: QID, text: 'What is H2O?', answer: 'Water', distractors: ['Salt', 'Wine'], funFact: 'Wet.', status: 'published', notes: 0 },
  ]);
  api.hideQuestion.mockResolvedValue({ ok: true, runId: 'r' });
  api.addRule.mockResolvedValue({ id: 1 });
  api.addNote.mockResolvedValue({ id: 1 });
});

const renderCat = () =>
  render(
    <MemoryRouter initialEntries={['/admin/c/physics']}>
      <Routes><Route path="/admin/c/:slug" element={<AdminCategory />} /></Routes>
    </MemoryRouter>,
  );

describe('AdminCategory', () => {
  it('shows breadcrumb and question details', async () => {
    renderCat();
    expect(await screen.findByText('What is H2O?')).toBeInTheDocument();
    expect(screen.getByText('Water')).toHaveClass('font-bold');
    expect(screen.getByText('Salt · Wine')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Science' })).toHaveAttribute('href', '/admin/c/science');
  });

  it('hide asks for a reason then posts it', async () => {
    renderCat();
    await userEvent.click(await screen.findByRole('button', { name: 'Hide' }));
    await userEvent.type(screen.getByLabelText('Reason for hiding'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(api.hideQuestion).toHaveBeenCalledWith(QID, 'wrong'));
  });

  it('rule posts with this question as the example', async () => {
    renderCat();
    await userEvent.click(await screen.findByRole('button', { name: 'Rule' }));
    await userEvent.type(screen.getByLabelText(/^Rule/), 'No chemistry formulas');
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(api.addRule).toHaveBeenCalledWith('No chemistry formulas', QID));
  });

  it('note posts a question note', async () => {
    renderCat();
    await userEvent.click(await screen.findByRole('button', { name: 'Note' }));
    await userEvent.type(screen.getByLabelText('Note'), 'check');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(api.addNote).toHaveBeenCalledWith('question', QID, 'check'));
  });

  it('hidden child categories are greyed with reason behind the toggle', async () => {
    renderCat();
    await screen.findByText('What is H2O?');
    expect(screen.queryByText('Optics')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Show hidden'));
    expect(await screen.findByText('Hidden: dupe')).toBeInTheDocument();
  });

  it('category note posts targetType category with the category id', async () => {
    renderCat();
    await screen.findByText('What is H2O?');
    await userEvent.click(screen.getByRole('button', { name: 'Note on category' }));
    await userEvent.type(screen.getByLabelText('Note'), 'merge later');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(api.addNote).toHaveBeenCalledWith('category', 'a1', 'merge later'));
  });

  it('shows the category note count', async () => {
    api.getTree.mockResolvedValue([
      cat({ id: 'a1', slug: 'physics', name: 'Physics', depth: 1, count: 12, notes: 3 }),
    ]);
    renderCat();
    expect(await screen.findByText('3 notes')).toBeInTheDocument();
  });

  it('rule form needs at least 5 characters and says so', async () => {
    renderCat();
    await userEvent.click(await screen.findByRole('button', { name: 'Rule' }));
    expect(screen.getByText('At least 5 characters')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Rule/), 'abcd');
    expect(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^Rule/), 'e');
    expect(screen.getByRole('button', { name: 'Save rule' })).toBeEnabled();
  });

  it('unhiding a parked question says Unhidden (finding 9)', async () => {
    api.getCategoryQuestions.mockResolvedValue([
      { id: QID, text: 'What is H2O?', answer: 'Water', distractors: [], funFact: null, status: 'parked', notes: 0 },
    ]);
    api.unhideQuestion.mockResolvedValue({ ok: true, runId: 'r' });
    renderCat();
    await screen.findByText('What is H2O?');
    await userEvent.click(screen.getByRole('button', { name: 'Unhide' }));
    expect(await screen.findByText('Unhidden')).toBeInTheDocument();
  });
});
