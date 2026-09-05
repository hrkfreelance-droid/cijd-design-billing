# CIJD Cloudflare Preview Operation

This file defines the permanent Cloudflare deployment path for CIJD development updates.

## Goal

Additional UI/UX instructions must not get blocked repeatedly by ad-hoc deployment credentials.
The normal path is Cloudflare Workers native Git integration, not a custom GitHub Actions deploy.

## Canonical Cloudflare project

- Worker: `cijd-design-billing-preview`
- Repository: `hrkfreelance-droid/cijd-design-billing`
- Production branch inside this Review Worker: `integrate-production-workspace`
- Production business Worker: do not touch without explicit authorization
- `main`: do not write
- Netlify: do not touch unless explicitly requested

## One-time Cloudflare dashboard settings

In Cloudflare Workers & Pages > `cijd-design-billing-preview` > Settings > Build:

1. Git integration: GitHub
2. Repository: `hrkfreelance-droid/cijd-design-billing`
3. Production branch: `integrate-production-workspace`
4. Build command: `npm run build:vinext`
5. Production deploy command: use the normal Worker deploy command (`npx wrangler deploy` / Cloudflare default)
6. Builds for non-production branches: **ON**
7. Non-production branch deploy command: use Cloudflare preview version upload (`npx wrangler versions upload` / Cloudflare default)
8. Preview URLs: **ON**

Repository `wrangler.jsonc` also explicitly sets `workers_dev: true` and `preview_urls: true` so Preview URL behavior is not dependent on Wrangler defaults.

## Normal update flow

For UI/UX fixes and additional instructions:

```text
git fetch --all --prune
        ↓
start from latest origin/integrate-production-workspace
        ↓
work on review/<topic> branch
        ↓
typecheck / relevant lint / build
        ↓
push review branch
        ↓
Cloudflare Workers Builds runs automatically
        ↓
Cloudflare creates/updates branch Preview URL
        ↓
verify /api/version and live UI
        ↓
share the Cloudflare Preview URL
```

A review branch must not overwrite the fixed canonical Review Worker deployment. Cloudflare non-production branch builds should create a version/branch Preview URL under workers.dev.

## Canonical Review update

Only after the review branch is approved and incorporated into `integrate-production-workspace` should the fixed Review Worker URL move forward:

`https://cijd-design-billing-preview.hrk-freelance.workers.dev`

That fixed URL is for the canonical `integrate-production-workspace` state, not for every work-in-progress branch.

## Rollback

Rollback is Git-first:

- Branch preview: previous commit/version remains available in Git and Cloudflare version history.
- Canonical Review Worker: restore/redeploy the previously verified `integrate-production-workspace` commit.
- Never reset or modify Supabase data as part of a UI rollback.

## Credential policy

- Do not create a GitHub Actions workflow that requires `CLOUDFLARE_API_TOKEN` just to preview ordinary CIJD changes.
- Do not ask Hiroki for a Cloudflare API Token if native Workers Git integration can perform the deployment.
- Do not paste Cloudflare tokens or secrets into chat, commits, logs, or source files.
- Manual `wrangler` deployment is fallback only, using an already-authorized local environment when available.

## Start-of-task preflight

Before implementing a new CIJD web change, verify the deployment path first:

- canonical repository and branch are reachable
- `wrangler.jsonc` points to `cijd-design-billing-preview`
- `preview_urls` is enabled
- Cloudflare Git integration is expected to handle branch previews
- rollback source is known

If Cloudflare does not create a preview after push, diagnose the Cloudflare Build/Git integration before inventing another hosting or CI path.
