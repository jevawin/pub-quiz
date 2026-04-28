## Cloudflare preview URL lookup

This repo deploys via Cloudflare Workers Git Integration (project name: `quiz`, account: `jevawin`). After every push to any branch, Cloudflare builds the worker and posts a check-run on the head commit. The preview URL is in the check-run output.

**Do NOT run `wrangler deploy` or `wrangler pages deploy` manually.** Deploys are owned by Cloudflare's Git integration. Wrangler from this machine is for read-only inspection only.

### After pushing a branch — how to fetch the preview URL

1. Wait ~30-90 seconds for the Cloudflare build to complete.
2. Pull the check-run for the branch HEAD:
   ```bash
   gh api repos/jevawin/pub-quiz/commits/<branch-name>/check-runs \
     --jq '.check_runs[] | select(.name | startswith("Workers Builds")) | .output.summary'
   ```
3. The summary contains a line like `Preview URL: https://<version-id-prefix>-quiz.jevawin.workers.dev` — that is the per-commit preview.

### When the user asks for the Cloudflare URL

Always fetch via the check-run API above. Do not guess the URL from the branch name — the format is `<8-char-version-id>-quiz.jevawin.workers.dev`, not `<branch>-quiz.jevawin.workers.dev`.

### PR comments

The Cloudflare bot (`cloudflare-workers-and-pages[bot]`) posts a comment with both Commit Preview URL and Branch Preview URL on pull requests. Bare branch pushes (no PR) get a check-run only, no comment. If a PR exists for the branch:

```bash
gh pr view <pr-number> --comments | grep -A2 "Preview URL"
```
