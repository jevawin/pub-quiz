// Cloudflare Access authentication, verified in code (not trusted from the edge): the
// `Cf-Access-Jwt-Assertion` header must be an RS256 JWT signed by the team's Access keys, issued by
// TEAM_DOMAIN, for POLICY_AUD, unexpired, with `email` equal to ADMIN_EMAIL (case-insensitive).
// ADMIN_EMAIL is a secret; if it is missing, a VALID token gets 500 (anonymous callers still get 401).
// A request that bypassed Access (e.g. a *.workers.dev preview URL) has no header -> 401.
import { createRemoteJWKSet, customFetch, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Env } from './env';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// Module-scope JWKS cache (per isolate), keyed by certs URL. jose refreshes it on an unknown kid.
const jwksCache = new Map<string, JWTVerifyGetKey>();

function jwksFor(env: Env, fetchCerts?: typeof fetch): JWTVerifyGetKey {
  const url = new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (fetchCerts) {
    // Injected fetch (tests): never shared with the production cache.
    return createRemoteJWKSet(url, {
      [customFetch]: (u: string, opts: RequestInit) => fetchCerts(u, opts),
    });
  }
  let set = jwksCache.get(url.href);
  if (!set) {
    set = createRemoteJWKSet(url);
    jwksCache.set(url.href, set);
  }
  return set;
}

export async function verifyAccess(
  req: Request,
  env: Env,
  fetchCerts?: typeof fetch,
): Promise<{ email: string } | Response> {
  const token = req.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return json({ error: 'unauthenticated' }, 401);

  let email: unknown;
  try {
    const { payload } = await jwtVerify(token, jwksFor(env, fetchCerts), {
      issuer: env.TEAM_DOMAIN,
      audience: env.POLICY_AUD,
      algorithms: ['RS256'],
      requiredClaims: ['exp'],
    });
    email = payload.email;
  } catch {
    return json({ error: 'unauthenticated' }, 401);
  }

  const admin = env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!admin || !admin.includes('@')) {
    return json({ error: 'admin API not configured: ADMIN_EMAIL secret is missing' }, 500);
  }
  if (typeof email !== 'string' || email.toLowerCase() !== admin) {
    return json({ error: 'forbidden' }, 403);
  }
  return { email };
}
