import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { LoadedQuestion } from '@/state/quiz';

// Mock plays + auth before importing component
vi.mock('@/lib/plays', () => ({
  recordQuestionPlay: vi.fn().mockResolvedValue(undefined),
  recordRecategorisation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/auth', () => ({
  ensureSessionId: vi.fn().mockResolvedValue('test-session-id'),
}));
vi.mock('@/lib/activeTimer', () => ({
  createActiveTimer: vi.fn(() => ({
    start: vi.fn(),
    pause: vi.fn(),
    reset: vi.fn(),
    elapsedMs: vi.fn(() => 1500),
    destroy: vi.fn(),
  })),
}));

import { Play } from './Play';
import { recordQuestionPlay } from '@/lib/plays';

const mockRecordPlay = recordQuestionPlay as ReturnType<typeof vi.fn>;

const stubQuestions: LoadedQuestion[] = [
  {
    id: 'q1',
    question_text: 'What is the capital of France?',
    options: ['London', 'Paris', 'Berlin', 'Madrid'],
    correctIndex: 1,
    explanation: 'Paris is the capital city of France.',
    category_slug: 'geography',
  },
  {
    id: 'q2',
    question_text: 'What is 2+2?',
    options: ['3', '4', '5', '6'],
    correctIndex: 1,
    explanation: 'Basic arithmetic.',
    category_slug: 'science',
  },
];

const stubConfig = { category: 'general', difficulty: 'Medium' as const, count: 2 };
const stubStartedAt = Date.now();

function renderPlay(state?: Record<string, unknown>) {
  const routeState = state ?? { questions: stubQuestions, config: stubConfig, startedAt: stubStartedAt };
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/play', state: routeState }]}>
      <Routes>
        <Route path="/" element={<div data-testid="home">Home</div>} />
        <Route path="/play" element={<Play />} />
        <Route path="/done" element={<div data-testid="done">Done</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockRecordPlay.mockReset().mockResolvedValue(undefined);
});

describe('Play screen', () => {
  it('deep-linking /play with no router state redirects to /', () => {
    render(
      <MemoryRouter initialEntries={['/play']}>
        <Routes>
          <Route path="/" element={<div data-testid="home">Home</div>} />
          <Route path="/play" element={<Play />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('home')).toBeInTheDocument();
  });

  it('renders the first question text and 4 option labels', () => {
    renderPlay();
    expect(screen.getByText('What is the capital of France?')).toBeInTheDocument();
    expect(screen.getByText('London')).toBeInTheDocument();
    expect(screen.getByText('Paris')).toBeInTheDocument();
    expect(screen.getByText('Berlin')).toBeInTheDocument();
    expect(screen.getByText('Madrid')).toBeInTheDocument();
  });

  it('selecting an option transitions to revealed - correct/incorrect banner + explanation visible', async () => {
    renderPlay();
    fireEvent.click(screen.getByText('Paris'));
    await waitFor(() => {
      expect(screen.getByText(/correct/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Paris is the capital city of France.')).toBeInTheDocument();
  });

  it('Too easy / Just right / Too hard feedback buttons appear after answer', async () => {
    renderPlay();
    fireEvent.click(screen.getByText('Paris'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /too easy/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /just right/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /too hard/i })).toBeInTheDocument();
    });
  });

  it('clicking "Just right" calls recordQuestionPlay with feedback_reaction === "just-right" then advances', async () => {
    renderPlay();
    fireEvent.click(screen.getByText('Paris'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /just right/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /just right/i }));
    await waitFor(() => {
      expect(mockRecordPlay).toHaveBeenCalledWith(
        expect.objectContaining({
          question_id: 'q1',
          feedback_reaction: 'just-right',
          is_correct: true,
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
    });
  });

  it('clicking "Too hard" calls recordQuestionPlay with feedback_reaction === "too-hard"', async () => {
    renderPlay();
    fireEvent.click(screen.getByText('Paris'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /too hard/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /too hard/i }));
    await waitFor(() => {
      expect(mockRecordPlay).toHaveBeenCalledWith(
        expect.objectContaining({
          question_id: 'q1',
          feedback_reaction: 'too-hard',
        }),
      );
    });
  });

  it('after the last question, navigates to /done', async () => {
    renderPlay();
    fireEvent.click(screen.getByText('Paris'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /just right/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /just right/i }));

    await waitFor(() => {
      expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('4'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /just right/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /just right/i }));

    await waitFor(() => {
      expect(screen.getByTestId('done')).toBeInTheDocument();
    });
  });
});
