import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { End } from './End';

const { mockRecordQuizSession, mockEnsureSessionId } = vi.hoisted(() => ({
  mockRecordQuizSession: vi.fn().mockResolvedValue(undefined),
  mockEnsureSessionId: vi.fn().mockResolvedValue('test-session-id'),
}));

vi.mock('@/lib/plays', () => ({
  recordQuizSession: mockRecordQuizSession,
}));

vi.mock('@/lib/auth', () => ({
  ensureSessionId: mockEnsureSessionId,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {},
}));

const defaultState = {
  score: 7,
  config: { category: 'general', difficulty: 'Easy' as const, count: 10 },
  startedAt: Date.now(),
};

function renderEnd(state = defaultState) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/done', state }]}>
      <Routes>
        <Route path="/done" element={<End />} />
        <Route path="/" element={<div data-testid="home">Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('End screen', () => {
  const writeTextMock = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

  beforeEach(() => {
    mockRecordQuizSession.mockClear().mockResolvedValue(undefined);
    mockEnsureSessionId.mockClear().mockResolvedValue('test-session-id');
    writeTextMock.mockClear();
    // jsdom doesn't provide navigator.clipboard, define it for tests
    if (!navigator.clipboard) {
      Object.defineProperty(window.navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      });
    } else {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        value: writeTextMock,
        writable: true,
        configurable: true,
      });
    }
  });

  it('renders score heading first, then rating form below', () => {
    renderEnd();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('You scored 7 / 10');

    // Rating buttons exist below the heading
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(screen.getByText('Okay')).toBeInTheDocument();
    expect(screen.getByText('Bad')).toBeInTheDocument();
  });

  it('has three rating buttons with text labels Good, Okay, Bad', () => {
    renderEnd();
    const goodBtn = screen.getByRole('button', { name: /good/i });
    const okayBtn = screen.getByRole('button', { name: /okay/i });
    const badBtn = screen.getByRole('button', { name: /bad/i });
    expect(goodBtn).toBeInTheDocument();
    expect(okayBtn).toBeInTheDocument();
    expect(badBtn).toBeInTheDocument();
  });

  it('feedback text input has no placeholder attribute', () => {
    renderEnd();
    const textarea = screen.getByLabelText(/anything to tell us/i);
    expect(textarea).not.toHaveAttribute('placeholder');
  });

  it('submit calls recordQuizSession with the correct row', async () => {
    const user = userEvent.setup();
    renderEnd();

    // Select a rating
    await user.click(screen.getByRole('button', { name: /good/i }));

    // Type feedback
    const textarea = screen.getByLabelText(/anything to tell us/i);
    await user.type(textarea, 'Great quiz!');

    // Submit
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(mockRecordQuizSession).toHaveBeenCalledOnce();
    });

    const row = mockRecordQuizSession.mock.calls[0][0];
    expect(row.session_id).toBe('test-session-id');
    expect(row.category_slug).toBe('general');
    expect(row.difficulty).toBe('easy'); // UI 'Easy' -> DB 'easy'
    expect(row.num_questions).toBe(10);
    expect(row.score).toBe(7);
    expect(row.overall_rating).toBe('good');
    expect(row.feedback_text).toBe('Great quiz!');
    expect(row.started_at).toBeDefined();
  });

  it('Share button calls navigator.clipboard.writeText with buildShareUrl', async () => {
    const user = userEvent.setup();
    renderEnd();

    await user.click(screen.getByRole('button', { name: /share/i }));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledOnce());
    const url = writeTextMock.mock.calls[0][0];
    expect(url).toContain('cat=general');
    expect(url).toContain('diff=Easy');
    expect(url).toContain('n=10');
  });

  it('Play Again button navigates to /', async () => {
    const user = userEvent.setup();
    renderEnd();

    await user.click(screen.getByRole('button', { name: /play again/i }));

    expect(screen.getByTestId('home')).toBeInTheDocument();
  });

  it('redirects to / when no router state is present', () => {
    render(
      <MemoryRouter initialEntries={['/done']}>
        <Routes>
          <Route path="/done" element={<End />} />
          <Route path="/" element={<div data-testid="home">Home</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('home')).toBeInTheDocument();
  });
});
