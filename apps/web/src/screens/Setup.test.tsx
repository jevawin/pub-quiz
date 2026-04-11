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
  it('renders with defaults (General / Easy / 10) when no query params', () => {
    renderSetup('/');

    // Category default: General should be checked
    const generalRadio = screen.getByRole('radio', { name: /general/i });
    expect(generalRadio).toBeChecked();

    // Difficulty default: Easy
    const easyRadio = screen.getByRole('radio', { name: /^easy$/i });
    expect(easyRadio).toBeChecked();

    // Count default: 10
    const tenRadio = screen.getByRole('radio', { name: /^10$/ });
    expect(tenRadio).toBeChecked();
  });

  it('pre-fills from query params ?cat=science-and-nature&diff=Hard&n=5', () => {
    renderSetup('/?cat=science-and-nature&diff=Hard&n=5');

    const scienceRadio = screen.getByRole('radio', { name: /science and nature/i });
    expect(scienceRadio).toBeChecked();

    const hardRadio = screen.getByRole('radio', { name: /^hard$/i });
    expect(hardRadio).toBeChecked();

    const fiveRadio = screen.getByRole('radio', { name: /^5$/ });
    expect(fiveRadio).toBeChecked();
  });

  it('falls back to defaults on invalid query params', () => {
    renderSetup('/?cat=bogus&diff=xxx&n=7');

    const generalRadio = screen.getByRole('radio', { name: /general/i });
    expect(generalRadio).toBeChecked();

    const easyRadio = screen.getByRole('radio', { name: /^easy$/i });
    expect(easyRadio).toBeChecked();

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

    const playButton = screen.getByRole('button', { name: /play/i });
    await user.click(playButton);

    await waitFor(() => {
      expect(mockFetchRandomQuestions).toHaveBeenCalledWith('Easy', 'general', 10);
    });

    await waitFor(() => {
      expect(screen.getByTestId('play-screen')).toBeInTheDocument();
    });
  });
});
