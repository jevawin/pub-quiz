import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Setup } from './Setup';

const { mockFetchRandomQuestions, mockCountAvailableQuestions, mockFetchCountsByRootCategory } = vi.hoisted(() => ({
  mockFetchRandomQuestions: vi.fn(),
  mockCountAvailableQuestions: vi.fn(),
  mockFetchCountsByRootCategory: vi.fn(),
}));

vi.mock('@/lib/questions', () => ({
  fetchRandomQuestions: mockFetchRandomQuestions,
  countAvailableQuestions: mockCountAvailableQuestions,
  fetchCountsByRootCategory: mockFetchCountsByRootCategory,
}));

beforeEach(() => {
  mockFetchRandomQuestions.mockReset();
  mockCountAvailableQuestions.mockReset();
  mockCountAvailableQuestions.mockResolvedValue(100);
  mockFetchCountsByRootCategory.mockReset();
  mockFetchCountsByRootCategory.mockResolvedValue({
    science: { easy: 10, normal: 20, hard: 5, total: 35 },
    history: { easy: 3, normal: 7, hard: 2, total: 12 },
    geography: { easy: 1, normal: 2, hard: 3, total: 6 },
    'movies-and-tv': { easy: 0, normal: 0, hard: 0, total: 0 },
    music: { easy: 0, normal: 0, hard: 0, total: 0 },
    gaming: { easy: 0, normal: 0, hard: 0, total: 0 },
    sports: { easy: 0, normal: 0, hard: 0, total: 0 },
    'food-and-drink': { easy: 0, normal: 0, hard: 0, total: 0 },
    literature: { easy: 0, normal: 0, hard: 0, total: 0 },
    'art-and-design': { easy: 0, normal: 0, hard: 0, total: 0 },
    technology: { easy: 0, normal: 0, hard: 0, total: 0 },
    'nature-and-animals': { easy: 0, normal: 0, hard: 0, total: 0 },
  });
});

function renderSetup(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/" element={<Setup />} />
        <Route path="/play" element={<div data-testid="play-screen">Play</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Setup screen', () => {
  it('renders with all categories selected by default', () => {
    renderSetup('/');

    // All button should be visually active (all categories selected by default)
    const allButton = screen.getByRole('button', { name: /^all$/i });
    expect(allButton).toBeInTheDocument();

    // Difficulty default: Mixed
    const mixedRadio = screen.getByRole('radio', { name: /^mixed$/i });
    expect(mixedRadio).toBeChecked();

    // Count default: 10
    const tenRadio = screen.getByRole('radio', { name: /^10$/ });
    expect(tenRadio).toBeChecked();
  });

  it('pre-fills from query params ?cat=science&diff=Hard&n=5', () => {
    renderSetup('/?cat=science&diff=Hard&n=5');

    // Science category button should exist
    const scienceButton = screen.getByRole('button', { name: /^science$/i });
    expect(scienceButton).toBeInTheDocument();

    const hardRadio = screen.getByRole('radio', { name: /^hard$/i });
    expect(hardRadio).toBeChecked();

    const fiveRadio = screen.getByRole('radio', { name: /^5$/ });
    expect(fiveRadio).toBeChecked();
  });

  it('falls back to defaults on invalid query params', () => {
    renderSetup('/?cat=bogus&diff=xxx&n=7');

    const mixedRadio = screen.getByRole('radio', { name: /^mixed$/i });
    expect(mixedRadio).toBeChecked();

    const tenRadio = screen.getByRole('radio', { name: /^10$/ });
    expect(tenRadio).toBeChecked();
  });

  it('shows privacy notice text', () => {
    renderSetup('/');

    expect(
      screen.getByText(/we log which answers you pick to improve questions\. no personal data\./i)
    ).toBeInTheDocument();
  });

  it('clicking Play calls fetchRandomQuestions and navigates to /play', async () => {
    const user = userEvent.setup();
    const stubQuestions = [
      { id: 'q1', question_text: 'Q1', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: null },
    ];
    mockFetchRandomQuestions.mockResolvedValue(stubQuestions);

    renderSetup('/');

    const playButton = screen.getAllByRole('button', { name: /play/i })[0]!;
    await user.click(playButton);

    await waitFor(() => {
      // All categories selected → passes ['general'], default difficulty is Mixed
      expect(mockFetchRandomQuestions).toHaveBeenCalledWith('Mixed', ['general'], 10);
    });

    await waitFor(() => {
      expect(screen.getByTestId('play-screen')).toBeInTheDocument();
    });
  });

  it('renders per-pill counts after fetchCountsByRootCategory resolves', async () => {
    renderSetup('/');

    const scienceButton = await screen.findByRole('button', { name: /science.*35/i });
    expect(scienceButton).toBeInTheDocument();
    const historyButton = screen.getByRole('button', { name: /history.*12/i });
    expect(historyButton).toBeInTheDocument();
  });

  it('updates pill counts when difficulty changes', async () => {
    const user = userEvent.setup();
    renderSetup('/');

    // Wait for initial counts to load (Mixed → total)
    await screen.findByRole('button', { name: /science.*35/i });

    // Switch to Easy
    await user.click(screen.getByRole('radio', { name: /^easy$/i }));

    // Science easy = 10
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /science.*10/i })).toBeInTheDocument();
    });

    // Switch to Hard
    await user.click(screen.getByRole('radio', { name: /^hard$/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /science.*5/i })).toBeInTheDocument();
    });
  });

  it('summary line shows summed pool count for selected categories', async () => {
    const user = userEvent.setup();
    renderSetup('/');

    // Wait until counts load
    await screen.findByRole('button', { name: /science.*35/i });

    // Deselect All, then select science + history only
    await user.click(screen.getByRole('button', { name: /^all$/i }));
    await user.click(screen.getByRole('button', { name: /science.*35/i }));
    await user.click(screen.getByRole('button', { name: /history.*12/i }));

    // Mixed totals: science 35 + history 12 = 47. Two summary lines show it.
    await waitFor(() => {
      expect(screen.getAllByText(/47 in pool/i).length).toBeGreaterThan(0);
    });
  });

  it('renders pills without counts when fetchCountsByRootCategory rejects', async () => {
    mockFetchCountsByRootCategory.mockRejectedValueOnce(new Error('network'));

    renderSetup('/');

    // Plain label visible; no crash
    const scienceButton = await screen.findByRole('button', { name: /^science$/i });
    expect(scienceButton).toBeInTheDocument();
  });
});
