// Quiz Worker entry. Static assets (the SPA) are served by the assets binding; only `/admin/api/*`
// runs Worker code first (wrangler.jsonc `run_worker_first`). Order for API requests:
//   1. config sanity (placeholders -> 500, no data, no outbound calls)
//   2. Access JWT (401 / 403; 500 if the ADMIN_EMAIL secret is missing) — before route lookup, so the
//      route table is not discoverable
//   3. Supabase admin key present (500)
//   4. route -> handler, else 404
import { createClient } from '@supabase/supabase-js';
import { verifyAccess, json } from './auth';
import { matchRoute } from './api';
import type { Env } from './env';

export interface Deps {
  fetch?: typeof fetch; // injected in tests; used for both the JWKS and Supabase
}

const API_PREFIX = '/admin/api/';

function configError(env: Env): string | null {
  const bad: string[] = [];
  const placeholder = (v: string | undefined) => !v || !v.trim() || v.includes('REPLACE-ME');
  if (placeholder(env.TEAM_DOMAIN) || !/^https:\/\/[^/]+$/.test(env.TEAM_DOMAIN)) bad.push('TEAM_DOMAIN');
  if (placeholder(env.POLICY_AUD)) bad.push('POLICY_AUD');
  if (placeholder(env.SUPABASE_URL)) bad.push('SUPABASE_URL');
  return bad.length ? `admin API not configured: set ${bad.join(', ')} in wrangler.jsonc vars` : null;
}

export async function handle(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(API_PREFIX)) return env.ASSETS.fetch(request);

  const cfg = configError(env);
  if (cfg) return json({ error: cfg }, 500);

  const auth = await verifyAccess(request, env, deps.fetch);
  if (auth instanceof Response) return auth;

  if (!env.SUPABASE_ADMIN_KEY) {
    return json({ error: 'admin API not configured: SUPABASE_ADMIN_KEY secret is missing' }, 500);
  }

  const match = matchRoute(request.method, url.pathname);
  if (!match) return json({ error: 'not found' }, 404);

  // CSRF hardening for state-changing requests (Access cookies ride along on cross-site requests).
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== url.origin) return json({ error: 'forbidden origin' }, 403);
    if (request.method === 'POST' && !/^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '')) {
      return json({ error: 'content-type must be application/json' }, 415);
    }
  }

  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ADMIN_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: deps.fetch ? { fetch: deps.fetch } : {},
  });

  try {
    return await match.route.handler({ sb, url, params: match.params, request, email: auth.email });
  } catch (e) {
    console.error('admin api error', request.method, url.pathname, e);
    return json({ error: 'internal error' }, 500);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
