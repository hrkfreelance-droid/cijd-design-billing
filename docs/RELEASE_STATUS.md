# CIJD Release Status

Last updated: 2026-09-05

This file records evidence, not intent. Do not turn TODO / UNVERIFIED into PASS without running the gate.

| Gate | Status | Evidence |
| --- | --- | --- |
| Print cost DB migration | PASS | Supabase migration `20260902083529 print_cost_billing_pricing` is applied on `dldfhhcechzhkbvlnzld` |
| Pricing rule DB check | PASS | cost 10→20, 20→40, 30→55, 100→170, 120→180 verified against DB function |
| UI/API implementation | IMPLEMENTED / TEST PENDING | modal editing, FIFO queues, full-card targets, cost/billing split, final billing override added in source |
| Typecheck | PASS on overhaul branch | GitHub Actions verification on 2026-09-05 passed `npm run typecheck` before credential gate |
| Changed-file lint | PASS on overhaul branch | changed implementation files passed lint on 2026-09-05 |
| vinext build | PASS on overhaul branch | `npm run build:vinext` passed on 2026-09-05 before credential gate |
| Full automated tests | UNVERIFIED | run relevant Playwright and release/auth/import tests before merge |
| Cloudflare branch Preview | CONFIG UPDATED / CLOUDFLARE BUILD SETTING UNVERIFIED | repo now uses native Workers Git integration policy and `preview_urls: true`; Cloudflare dashboard non-production branch builds still need confirmation |
| Canonical Review URL | LIVE OLD BASE | `https://cijd-design-billing-preview.hrk-freelance.workers.dev` returned commit `75127f75cc3307109ccd558c56192c703fb681c7` during 2026-09-05 verification |
| Overhaul branch live URL | NOT YET VERIFIED | no Cloudflare PR comment/status was observed after push; do not claim branch preview live yet |
| Production Worker | UNTOUCHED | no production deploy authorized |
| Netlify | UNTOUCHED | no Netlify operation authorized |
| `main` | UNTOUCHED | work remains outside `main` |

## Cloudflare deployment rule

The canonical automated path is Cloudflare Workers native Git integration.

- `integrate-production-workspace` = canonical branch for the fixed Review Worker.
- `review/*` = Cloudflare non-production branch build → branch/version Preview URL.
- GitHub Actions with `CLOUDFLARE_API_TOKEN` is not the normal preview path.
- Manual `npm run deploy:review` is fallback only for the canonical branch from an already-authorized local environment.
- See `docs/CLOUDFLARE_PREVIEW_OPERATION.md`.

## UI change checklist

- [x] Projects list opens project editor in modal/sheet instead of routine page navigation.
- [x] Project/card surfaces are clickable; nested controls keep their own actions.
- [x] Active project and printing queues use oldest-first ordering.
- [x] New Project moved out of the crowded PageHeader action area.
- [x] Print staff input is explicitly internal print cost.
- [x] Designer can confirm/edit print cost through the same controlled print-cost RPC.
- [x] Suggested billing is calculated from cost and rounded upward to clean 5/10 steps.
- [x] Billing/Designer can override final billing before invoice; manual override is preserved across later cost changes.
- [x] Billing project rows open a correction modal; invoice creation stays on the current queue.
- [x] Invoiced/Paid/imported history remain locked by database rules.

## Do not claim completion yet when any gate below is unresolved

A release is fully complete only when CODE PASS, DEPLOY PASS and the appropriate LIVE PASS are independently verified.

For work-in-progress branches, branch LIVE PASS requires the Cloudflare branch Preview `/api/version` to match that branch HEAD.
For the fixed Review Worker, LIVE PASS requires the canonical URL `/api/version` to match current `origin/integrate-production-workspace` HEAD.

If verification fails, the required wording is:

`DO NOT CLAIM LIVE COMPLETE`
