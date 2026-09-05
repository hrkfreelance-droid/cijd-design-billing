# CIJD Cloudflare Review Operation

This file defines the permanent Cloudflare review/deployment path for CIJD so ChatGPT, Codex, Claude Code, and human maintainers can update the same review environment without re-solving hosting every time.

## Permanent topology

- Repository: `hrkfreelance-droid/cijd-design-billing`
- Review source branch: `integrate-production-workspace`
- Fixed Cloudflare Review Worker: `cijd-design-billing-preview`
- Fixed review URL: `https://cijd-design-billing-preview.hrk-freelance.workers.dev`
- Production/main infrastructure: untouched unless explicitly authorized
- Supabase data/schema: independent from UI review deployment and never reset for preview work

The fixed Review Worker is the persistent AI-editable environment. Normal UI/UX and workflow updates should end up on `integrate-production-workspace` after review and then be deployed by Cloudflare Workers native Git integration.

## Why this is the canonical path

Cloudflare Workers native Git integration owns Cloudflare authentication. Do not add a second GitHub Actions deployment path that requires `CLOUDFLARE_API_TOKEN` for routine work.

Future assistants should be able to:

1. Read this file and `docs/CANONICAL_OPERATION.md` before implementation.
2. Start from current `origin/integrate-production-workspace`.
3. Work on a reversible `review/*` branch when the change is significant.
4. Run code/build checks.
5. Merge the approved change into `integrate-production-workspace` only for the Review environment.
6. Let Cloudflare native Git integration rebuild the same fixed Review Worker.
7. Verify `/api/version` before claiming LIVE PASS.
8. Preserve the previous commit SHA as the rollback target.

## Cloudflare one-time account configuration

Worker `cijd-design-billing-preview` must stay connected to GitHub repository `hrkfreelance-droid/cijd-design-billing` using Workers Builds.

Cloudflare dashboard settings:

- Settings → Build → Git repository: `hrkfreelance-droid/cijd-design-billing`
- Production branch: `integrate-production-workspace`
- Build command: `npm run build:vinext`
- Production deploy command: Cloudflare default / `npx wrangler deploy`
- Builds for non-production branches: ON when branch previews are desired
- Non-production deploy command: Cloudflare default / `npx wrangler versions upload`
- Settings → Domains & Routes → Preview URLs: ON

`wrangler.jsonc` also keeps `workers_dev: true` and `preview_urls: true` so repository configuration agrees with the dashboard.

## Normal update flow

```text
fetch latest integrate-production-workspace
        ↓
create/update reversible review branch if needed
        ↓
typecheck / relevant lint / build / tests
        ↓
merge approved review change into integrate-production-workspace
        ↓
Cloudflare Workers native Git integration builds automatically
        ↓
fixed Review URL updates
        ↓
GET /api/version
        ↓
commit == current integrate-production-workspace HEAD
        ↓
LIVE PASS
```

For small follow-up fixes already inside an active reviewed change, it is acceptable to update the same review branch and merge again after checks. Do not create a new hosting project for each instruction.

## Rollback

Before every Review merge/deploy, record the previous `integrate-production-workspace` HEAD.

If the new Review build is bad:

- revert the merge/commit on `integrate-production-workspace`, or
- restore the recorded previous commit through Git,
- let Cloudflare native Git integration redeploy,
- verify `/api/version` again.

Cloudflare Version history can also assist rollback, but Git remains the source of truth.

Never roll back by resetting Supabase data.

## Mandatory preflight for every future web update

Before implementation begins, confirm:

1. repository
2. source/review branch
3. Cloudflare Worker/project name
4. fixed Review URL
5. build command
6. deploy ownership (Cloudflare native Git integration)
7. rollback commit
8. whether production/main is authorized

Do not discover these only after implementation is complete.

## PASS definitions

- CODE PASS = source checks passed
- DEPLOY PASS = Cloudflare build/deploy completed
- LIVE PASS = fixed Review URL `/api/version` matches current `integrate-production-workspace` HEAD

Never claim deployment complete from CODE PASS alone.
