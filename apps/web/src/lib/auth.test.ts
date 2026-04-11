import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      signInAnonymously: vi.fn(),
    },
  },
}));

import { ensureSessionId, __resetSessionPromise } from './auth';
import { supabase } from './supabase';

const getSession = supabase.auth.getSession as ReturnType<typeof vi.fn>;
const signInAnonymously = supabase.auth.signInAnonymously as ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetSessionPromise();
  getSession.mockReset();
  signInAnonymously.mockReset();
});

describe('ensureSessionId', () => {
  it('returns existing session id when present', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'abc' } } } });
    await expect(ensureSessionId()).resolves.toBe('abc');
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('signs in anonymously when no session', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    signInAnonymously.mockResolvedValue({
      data: { session: { user: { id: 'new-id' } } },
      error: null,
    });
    await expect(ensureSessionId()).resolves.toBe('new-id');
  });

  it('memoises concurrent calls', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    signInAnonymously.mockResolvedValue({
      data: { session: { user: { id: 'm' } } },
      error: null,
    });
    const [a, b] = await Promise.all([ensureSessionId(), ensureSessionId()]);
    expect(a).toBe('m');
    expect(b).toBe('m');
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('rejects on sign-in error', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    signInAnonymously.mockResolvedValue({
      data: { session: null },
      error: new Error('disabled'),
    });
    await expect(ensureSessionId()).rejects.toThrow('disabled');
  });
});
