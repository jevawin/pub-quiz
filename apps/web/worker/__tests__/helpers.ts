// Shared test helpers for the admin Worker: an RS256 key pair, a JWKS served by a stub fetch,
// token signing, a valid Env, and a tiny in-memory PostgREST fake (eq / in / is filters,
// offset/limit paging with the real 1000-row cap).
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';
import type { Env } from '../env';

export const TEAM = 'https://team.cloudflareaccess.com';
export const AUD = 'aud-123';
export const ADMIN = 'owner@example.com';
export const SB_URL = 'https://proj.supabase.co';

export interface Keys {
  privateKey: CryptoKey;
  jwk: JWK;
}

export async function makeKeys(kid = 'k1'): Promise<Keys> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  return { privateKey, jwk };
}

export function makeEnv(over: Partial<Env> = {}): Env {
  return {
    TEAM_DOMAIN: TEAM,
    POLICY_AUD: AUD,
    ADMIN_EMAIL: ADMIN,
    SUPABASE_URL: SB_URL,
    SUPABASE_ADMIN_KEY: 'sb_secret_test',
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) },
    ...over,
  };
}

export interface SignOpts {
  email?: string | null;
  aud?: string;
  iss?: string;
  exp?: number | string;
  nbf?: number | string;
  kid?: string;
}

export async function sign(keys: Keys, o: SignOpts = {}): Promise<string> {
  const claims: Record<string, unknown> = {};
  if (o.email !== null) claims.email = o.email ?? ADMIN;
  const jwt = new SignJWT(claims);
  if (o.nbf !== undefined) jwt.setNotBefore(o.nbf);
  return jwt
    .setProtectedHeader({ alg: 'RS256', kid: o.kid ?? (keys.jwk.kid as string) })
    .setIssuer(o.iss ?? TEAM)
    .setAudience(o.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? '5m')
    .sign(keys.privateKey);
}

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export interface Write {
  method: string;
  table: string; // table name, or `rpc/<fn>`
  query: string;
  body: any;
}

export interface StubFetch {
  fetch: typeof fetch;
  calls: string[];
  writes: Write[];
}

/** Returns the rows a write responds with (default: one row `{ id: 1 }`). */
export type WriteReply = (w: Write) => unknown;

/** One fetch for both the JWKS and Supabase. Any other URL throws. */
export function stubFetch(keys: Keys, tables: Tables = {}, reply: WriteReply = () => [{ id: 1 }]): StubFetch {
  const calls: string[] = [];
  const writes: Write[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.href);
    if (url.href === `${TEAM}/cdn-cgi/access/certs`) {
      return Response.json({ keys: [keys.jwk] });
    }
    if (url.origin === SB_URL && url.pathname.startsWith('/rest/v1/')) {
      const method = (init?.method ?? 'GET').toUpperCase();
      const table = url.pathname.slice('/rest/v1/'.length);
      if (method !== 'GET') {
        const raw = typeof init?.body === 'string' ? init.body : '';
        const w: Write = { method, table, query: url.search, body: raw ? JSON.parse(raw) : null };
        writes.push(w);
        const out = reply(w);
        const accept = new Headers(init?.headers).get('accept') ?? '';
        const single = accept.includes('vnd.pgrst.object') && Array.isArray(out) ? out[0] : out;
        return Response.json(single ?? null, { status: method === 'POST' && !table.startsWith('rpc/') ? 201 : 200 });
      }
      const rows = tables[table];
      if (!rows) return Response.json({ message: `relation ${table} does not exist` }, { status: 404 });
      return Response.json(applyQuery(rows, url.searchParams));
    }
    throw new Error(`stub: unexpected fetch ${url.href}`);
  };
  return { fetch: fn as typeof fetch, calls, writes };
}

function parseList(v: string): string[] {
  return v.replace(/^\(/, '').replace(/\)$/, '').split(',').map((s) => s.replace(/^"(.*)"$/, '$1'));
}

function applyQuery(rows: Row[], q: URLSearchParams): Row[] {
  let out = rows;
  for (const [k, v] of q) {
    if (['select', 'order', 'offset', 'limit'].includes(k)) continue;
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith('in.')) {
      const set = new Set(parseList(v.slice(3)));
      out = out.filter((r) => set.has(String(r[k])));
    } else if (v === 'is.null') out = out.filter((r) => r[k] === null || r[k] === undefined);
    else if (v === 'not.is.null') out = out.filter((r) => r[k] !== null && r[k] !== undefined);
    else throw new Error(`stub: unsupported filter ${k}=${v}`);
  }
  const order = q.get('order');
  if (order) {
    const [col, dir] = (order.split(',')[0] as string).split('.');
    out = [...out].sort((a, b) => {
      const x = a[col as string] as number | string;
      const y = b[col as string] as number | string;
      const c = x < y ? -1 : x > y ? 1 : 0;
      return dir === 'desc' ? -c : c;
    });
  }
  const offset = Number(q.get('offset') ?? 0);
  const limit = Math.min(Number(q.get('limit') ?? 1000), 1000); // PostgREST max-rows cap
  return out.slice(offset, offset + limit);
}

export function req(path: string, token?: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}): Request {
  const headers = new Headers(extra);
  if (token) headers.set('Cf-Access-Jwt-Assertion', token);
  if (body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(`https://quiz.example${path}`, init);
}
