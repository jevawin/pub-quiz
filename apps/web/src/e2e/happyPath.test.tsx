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
}));

vi.mock('@/lib/plays', () => ({
  recordQuestionPlay: mockRecordQuestionPlay,
  recordQuizSession: mockRecordQuizSession,
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
  });

  it('walks through setup → answer all questions → submit feedback', async () => {
    const user = userEvent.setup();
    renderApp();

    // --- Setup screen ---
    expect(screen.getByRole('heading', { name: /self-learning quiz/i })).toBeInTheDocument();

    // Click Play
    const playButton = screen.getByRole('button', { name: /play/i });
    await user.click(playButton);

    // Wait for navigation to /play
    await waitFor(() => {
      expect(mockFetchRandomQuestions).toHaveBeenCalledWith('Easy', 'general', 10);
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

      // Click the first option (correct answer)
      const optionButton = screen.getByRole('button', { name: 'A' });
      await user.click(optionButton);

      // Should show "Correct!" after answering
      await waitFor(() => {
        expect(screen.getByText(/correct!/i)).toBeInTheDocument();
      });

      // Click "good" feedback button
      const goodFeedback = screen.getByRole('button', { name: /good: next question/i });
      await user.click(goodFeedback);

      // Wait for recordQuestionPlay to be called
      await waitFor(() => {
        expect(mockRecordQuestionPlay).toHaveBeenCalledTimes(i + 1);
      });
    }

    // --- End screen ---
    await waitFor(() => {
      expect(screen.getByText(/you scored 5 \/ 10/i)).toBeInTheDocument();
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
