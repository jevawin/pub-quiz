// Bindings for the quiz Worker. `vars` live in wrangler.jsonc; SUPABASE_ADMIN_KEY and ADMIN_EMAIL are Worker
// secrets set in the Cloudflare dashboard (never in the repo — it is public — never sent to the browser).
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  TEAM_DOMAIN: string; // e.g. https://<team>.cloudflareaccess.com (no trailing slash)
  POLICY_AUD: string; // Access application AUD tag
  ADMIN_EMAIL?: string; // SECRET (the repo is public): the single allowed identity
  SUPABASE_URL: string;
  SUPABASE_ADMIN_KEY?: string;
}
