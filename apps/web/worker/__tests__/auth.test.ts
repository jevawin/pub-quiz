// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyAccess } from '../auth';
import { handle } from '../index';
import { ROUTES } from '../api';
import { ADMIN, makeEnv, makeKeys, req, sign, stubFetch, type Keys } from './helpers';

let keys: Keys;
let other: Keys;

beforeAll(async () => {
  keys = await makeKeys('k1');
  other = await makeKeys('k1'); // same kid, different key -> signature must fail
});

async function status(r: { email: string } | Response): Promise<number | string> {
  return r instanceof Response ? r.status : r.email;
}

describe('verifyAccess', () => {
  it('no header -> 401', async () => {
    const { fetch } = stubFetch(keys);
    expect(await status(await verifyAccess(req('/admin/api/tree'), makeEnv(), fetch))).toBe(401);
  });

  it('garbage token -> 401', async () => {
    const { fetch } = stubFetch(keys);
    expect(await status(await verifyAccess(req('/admin/api/tree', 'not.a.jwt'), makeEnv(), fetch))).toBe(401);
  });

  it('bad signature -> 401', async () => {
    const { fetch } = stubFetch(keys);
    const t = await sign(other);
    expect(await status(await verifyAccess(req('/admin/api/tree', t), makeEnv(), fetch))).toBe(401);
  });

  it('wrong audience -> 401', async () => {
    const { fetch } = stubFetch(keys);
    const t = await sign(keys, { aud: 'someone-else' });
    expect(await status(await verifyAccess(req('/admin/api/tree', t), makeEnv(), fetch))).toBe(401);
  });

  it('wrong issuer -> 401', async () => {
    const { fetch } = stubFetch(keys);
    const t = await sign(keys, { iss: 'https://evil.cloudflareaccess.com' });
    expect(await status(await verifyAccess(req('/admin/api/tree', t), makeEnv(), fetch))).toBe(401);
  });

  it('expired -> 401', async () => {
    const { fetch } = stubFetch(keys);
    const t = await sign(keys, { exp: Math.floor(Date.now() / 1000) - 3600 });
    expect(await status(await verifyAccess(req('/admin/api/tree', t), makeEnv(), fetch))).toBe(401);
  });

  it('not yet valid (nbf in the future) -> 401', async () => {
    const { fetch } = stubFetch(keys);
    const t = await sign(keys, { nbf: Math.floor(Date.now() / 1000) + 3600 });
    expect(await status(await verifyAccess(req('/admin/api/tree', t), makeEnv(), fetch))).toBe(401);
  });

  it('alg none / HS256 token -> 401', async () => {
    const { fetch } = stubFetch(keys);
    const enc = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const now = Math.floor(Date.now() / 1000);
    const body = enc({ email: ADMIN, aud: 'aud-123', iss: 'https://team.cloudflareaccess.com', exp: now + 300 });
    const none = `${enc({ alg: 'none' })}.${body}.`;
    expect(await status(await verifyAccess(req('/admin/api/tree', none), makeEnv(), fetch))).toBe(401);
  });

  it('missing email claim -> 403', async () => {
    const { fetch } = stubFetch(keys);
    const t = await sign(keys, { email: null });
    expect(await status(await verifyAccess(req('/admin/api/tree', t), makeEnv(), fetch))).toBe(403);
  });

  it('wrong email -> 403', async () => {
    const { fetch } = stubFetch(keys);
    const t = await sign(keys, { email: 'someone@example.com' });
    expect(await status(await verifyAccess(req('/admin/api/tree', t), makeEnv(), fetch))).toBe(403);
  });

  it('right email (any case) -> passes', async () => {
    const { fetch } = stubFetch(keys);
    const t = await sign(keys, { email: ADMIN.toUpperCase() });
    expect(await status(await verifyAccess(req('/admin/api/tree', t), makeEnv(), fetch))).toBe(ADMIN.toUpperCase());
  });
});

describe('handle', () => {
  it('every /admin/api route returns 401 without a header, and never reaches Supabase', async () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(5);
    for (const r of ROUTES) {
      const { fetch, calls } = stubFetch(keys);
      const path = r.path.replace(/:[a-z]+/gi, 'x');
      const res = await handle(req(path, undefined, r.method), makeEnv(), { fetch });
      expect(res.status, `${r.method} ${path}`).toBe(401);
      expect(calls.filter((c) => c.includes('supabase')), path).toEqual([]);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('unknown /admin/api path: 401 unauthenticated, 404 authenticated', async () => {
    const { fetch } = stubFetch(keys);
    expect((await handle(req('/admin/api/nope'), makeEnv(), { fetch })).status).toBe(401);
    const t = await sign(keys);
    expect((await handle(req('/admin/api/nope', t), makeEnv(), { fetch })).status).toBe(404);
  });

  it('wrong email is 403 on a real route', async () => {
    const { fetch, calls } = stubFetch(keys);
    const t = await sign(keys, { email: 'x@example.com' });
    expect((await handle(req('/admin/api/tree', t), makeEnv(), { fetch })).status).toBe(403);
    expect(calls.filter((c) => c.includes('supabase'))).toEqual([]);
  });

  it('placeholder config -> 500 with a clear message, no data', async () => {
    const { fetch, calls } = stubFetch(keys);
    const t = await sign(keys);
    for (const env of [
      makeEnv({ TEAM_DOMAIN: 'https://REPLACE-ME.cloudflareaccess.com' }),
      makeEnv({ POLICY_AUD: 'REPLACE-ME' }),
    ]) {
      const res = await handle(req('/admin/api/tree', t), env, { fetch });
      expect(res.status).toBe(500);
      expect(((await res.json()) as { error: string }).error).toMatch(/not configured/i);
    }
    expect(calls).toEqual([]);
  });

  it('missing SUPABASE_ADMIN_KEY -> 500 for an authenticated caller, 401 for anyone else', async () => {
    const { fetch, calls } = stubFetch(keys);
    const env = makeEnv({ SUPABASE_ADMIN_KEY: undefined });
    expect((await handle(req('/admin/api/tree'), env, { fetch })).status).toBe(401);
    const res = await handle(req('/admin/api/tree', await sign(keys)), env, { fetch });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/SUPABASE_ADMIN_KEY/);
    expect(calls.filter((c) => c.includes('supabase'))).toEqual([]);
  });

  it('missing ADMIN_EMAIL secret -> 401 anonymous, 500 for a valid token, never data', async () => {
    for (const env of [makeEnv({ ADMIN_EMAIL: undefined }), makeEnv({ ADMIN_EMAIL: '  ' })]) {
      const { fetch, calls } = stubFetch(keys);
      expect((await handle(req('/admin/api/tree'), env, { fetch })).status).toBe(401);
      const res = await handle(req('/admin/api/tree', await sign(keys)), env, { fetch });
      expect(res.status).toBe(500);
      expect(((await res.json()) as { error: string }).error).toMatch(/ADMIN_EMAIL/);
      expect(calls.filter((c) => c.includes('supabase'))).toEqual([]);
    }
  });

  it('non-API paths go to static assets without auth', async () => {
    const { fetch } = stubFetch(keys);
    const res = await handle(req('/admin'), makeEnv(), { fetch });
    expect(await res.text()).toBe('asset');
  });
});
