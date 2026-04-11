import { supabase } from './supabase';

let sessionPromise: Promise<string> | null = null;

export function ensureSessionId(): Promise<string> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { data: existing } = await supabase.auth.getSession();
      if (existing.session) return existing.session.user.id;
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      if (!data.session) throw new Error('No session returned');
      return data.session.user.id;
    })();
  }
  return sessionPromise;
}

// Exported for tests only
export function __resetSessionPromise() {
  sessionPromise = null;
}
