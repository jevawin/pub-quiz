import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Setup } from './Setup';

const { mockFetchRandomQuestions } = vi.hoisted(() => ({
  mockFetchRandomQuestions: vi.fn(),
}));

vi.mock('@/lib/questions', () => ({
  fetchRandomQuestions: mockFetchRandomQuestions,
}));

beforeEach(() => {
  mockFetchRandomQuestions.mockReset();
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
});
