<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CIJD permanent operation guard

Read `docs/CANONICAL_OPERATION.md`, `docs/CLOUDFLARE_PREVIEW_OPERATION.md`, `docs/RELEASE_STATUS.md`, and `docs/UI_WORKFLOW_INVARIANTS.md` before changing or deploying CIJD.

Every new task starts with `git fetch --all --prune`. The source of truth for the persistent Review environment is the current `origin/integrate-production-workspace` HEAD, never a SHA copied from an old conversation.

Before implementation begins, record this deployment preflight:

- repository: `hrkfreelance-droid/cijd-design-billing`
- Review branch: `integrate-production-workspace`
- Review Worker: `cijd-design-billing-preview`
- Review URL: `https://cijd-design-billing-preview.hrk-freelance.workers.dev`
- build command: `npm run build:vinext`
- deploy owner: Cloudflare Workers native Git integration
- current Review HEAD as rollback point
- production/main authorization state

Do not postpone deploy-path discovery until after implementation.

Hard rules:

- Do not write to `main`.
- Do not touch Netlify unless Hiroki explicitly asks for that exact action.
- Do not deploy to a production Cloudflare Worker unless Hiroki explicitly authorizes production deployment.
- Normal CIJD public review target is the fixed Review Worker `cijd-design-billing-preview` following `integrate-production-workspace`.
- Cloudflare Workers native Git integration is the canonical automated deploy path. Do not add a routine GitHub Actions deploy requiring `CLOUDFLARE_API_TOKEN`.
- Significant work may happen on a reversible `review/*` branch, then merge into `integrate-production-workspace` after checks and approval.
- Before every Review merge/deploy, record the previous `integrate-production-workspace` HEAD as the rollback target.
- Keep CODE PASS, DEPLOY PASS and LIVE PASS separate. A successful build or merge is not LIVE PASS.
- LIVE PASS requires the fixed Review URL `/api/version` to match the current `integrate-production-workspace` HEAD.
- If live verification fails, state `DO NOT CLAIM LIVE COMPLETE` and leave Live status unresolved.
- Supabase migrations are append-only. Never edit an already-applied migration; add a corrective migration.
- Never use Supabase reset/reseed/truncate as a UI rollback mechanism.

# CIJD / DAISHIN UI rule

- Use DAISHIN as the default interaction reference for CIJD: compact queues, whole-row/card selection, focused modal/sheet editing, one obvious primary action, and no duplicated actions in list rows.
- Prefer selecting a row/card and then acting inside the focused detail surface. Do not scatter Complete / Deliver / Review / Edit buttons across a list when they belong to the selected record.
- Keep narrow sheets visually calm. Do not cram unrelated controls into two-column grids. Group one logical decision at a time.
- Quantity × price entry is bidirectional everywhere it appears: editing unit recalculates total; editing total recalculates unit; the last edited field stays authoritative when quantity changes.
- PRINT internal cost and customer billing are separate facts and separate permissions. Printing edits cost only; Designer/Billing may edit customer billing.
- PRINT cost must be confirmed before delivery advances the item to Ready to Invoice.
- Active queues are FIFO (oldest actionable first); history may be newest-first.
