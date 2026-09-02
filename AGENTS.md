<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CIJD permanent operation guard

Read `docs/CANONICAL_OPERATION.md` and `docs/RELEASE_STATUS.md` before changing or deploying CIJD.

Every new task starts with `git fetch --all --prune`. The source of truth is the current `origin/integrate-production-workspace` HEAD, never a SHA copied from an old conversation.

Hard rules:

- Do not write to `main`.
- Do not touch Netlify unless Hiroki explicitly asks for that exact action.
- Do not deploy to a production Cloudflare Worker unless Hiroki explicitly authorizes production deployment.
- Normal CIJD deployment target is only the fixed Review Worker `cijd-design-billing-preview` via `npm run deploy:review`.
- Do not use hash/version URLs as the normal share URL.
- Keep CODE PASS, DEPLOY PASS and LIVE PASS separate. A successful build or deploy command is not LIVE PASS.
- LIVE PASS requires `npm run verify:live` to show that canonical `/api/version` commit equals current `origin/integrate-production-workspace` HEAD.
- If live verification fails, state `DO NOT CLAIM LIVE COMPLETE` and leave Live status unresolved.
- Supabase migrations are append-only. Never edit an already-applied migration; add a corrective migration.
