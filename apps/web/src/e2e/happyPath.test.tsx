import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Setup } from '@/screens/Setup';
import { Play } from '@/screens/Play';
import { End } from '@/screens/End';
import type { LoadedQuestion } from '@/state/quiz';

// --- Mocks ---

const { mockFetchRandomQuestions, mockRecordQuestionPlay, mockRecordQuizSession, mockEnsureSessionId } =
  vi.hoisted(() => ({
    mockFetchRandomQuestions: vi.fn(),
    mockRecordQuestionPlay: vi.fn(),
    mockRecordQuizSession: vi.fn(),
    mockEnsureSessionId: vi.fn(),
  }));

vi.mock('@/lib/questions', () => ({
  fetchRandomQuestions: mockFetchRandomQuestions,
  fetchCountsByRootCategory: vi.fn().mockResolvedValue({}),
  countAvailableQuestions: vi.fn().mockResolvedValue(100),
}));

vi.mock('@/lib/plays', () => ({
  recordQuestionPlay: mockRecordQuestionPlay,
  recordQuizSession: mockRecordQuizSession,
  recordRecategorisation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/auth', () => ({
  ensureSessionId: mockEnsureSessionId,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {},
}));

// --- Test data ---

const QUESTIONS: LoadedQuestion[] = Array.from({ length: 5 }, (_, i) => ({
  id: `q-${i}`,
  question_text: `Question ${i + 1}?`,
  options: ['A', 'B', 'C', 'D'],
  correctIndex: 0,
  explanation: `Explanation for Q${i + 1}`,
  category_slug: 'science',
}));

// --- Helpers ---

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Setup />} />
        <Route path="/play" element={<Play />} />
        <Route path="/done" element={<End />} />
      </Routes>
    </MemoryRouter>,
  );
}

// --- Tests ---

describe('Happy path: setup → play → done', () => {
  beforeEach(() => {
    mockFetchRandomQuestions.mockReset().mockResolvedValue(QUESTIONS);
    mockRecordQuestionPlay.mockReset().mockResolvedValue(undefined);
    mockRecordQuizSession.mockReset().mockResolvedValue(undefined);
    mockEnsureSessionId.mockReset().mockResolvedValue('test-session-id');
    sessionStorage.clear();
  });

  it('walks through setup → answer all questions → submit feedback', async () => {
    const user = userEvent.setup();
    renderApp();

    // --- Setup screen ---
    expect(screen.getByRole('heading', { name: /trivia quiz/i })).toBeInTheDocument();

    // Click Play
    const playButton = screen.getAllByRole('button', { name: /play/i })[0]!;
    await user.click(playButton);

    // Wait for navigation to /play
    await waitFor(() => {
      expect(mockFetchRandomQuestions).toHaveBeenCalledWith('Mixed', ['general'], 10);
    });

    // --- Play screen ---
    await waitFor(() => {
      expect(screen.getByText(/question 1 of 5/i)).toBeInTheDocument();
    });

    // Answer each question: click first option (correct), then click "Next" feedback
    for (let i = 0; i < 5; i++) {
      // Wait for question text
      await waitFor(() => {
        expect(screen.getByText(`Question ${i + 1}?`)).toBeInTheDocument();
      });

      // Click the first option (correct answer) — selects it
      const optionButton = screen.getByRole('button', { name: 'A' });
      await user.click(optionButton);

      // Lock in the answer
      const lockInBtn = await screen.findByRole('button', { name: /lock in/i });
      await user.click(lockInBtn);

      // Should show "Correct!" after confirming
      await waitFor(() => {
        expect(screen.getByText(/correct!/i)).toBeInTheDocument();
      });

      // Click "Next" to advance
      const nextBtn = screen.getByRole('button', { name: /next/i });
      await user.click(nextBtn);

      // Wait for recordQuestionPlay to be called
      await waitFor(() => {
        expect(mockRecordQuestionPlay).toHaveBeenCalledTimes(i + 1);
      });
    }

    // --- End screen ---
    await waitFor(() => {
      expect(screen.getByText(/you scored 5 \/ 5/i)).toBeInTheDocument();
    });

    // Click "Good" rating
    const goodButton = screen.getByRole('button', { name: /good/i });
    await user.click(goodButton);

    // Type feedback
    const textarea = screen.getByLabelText(/anything to tell us/i);
    await user.type(textarea, 'great quiz');

    // Submit
    const submitButton = screen.getByRole('button', { name: /submit/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockRecordQuizSession).toHaveBeenCalledTimes(1);
    });

    const sessionCall = mockRecordQuizSession.mock.calls[0]![0];
    expect(sessionCall.session_id).toBe('test-session-id');
    expect(sessionCall.score).toBe(5);
    expect(sessionCall.overall_rating).toBe('good');
    expect(sessionCall.feedback_text).toBe('great quiz');

    // Should show thanks
    expect(screen.getByText(/thanks for the feedback/i)).toBeInTheDocument();
  });
});
