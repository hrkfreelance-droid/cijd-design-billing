# CIJD Release Status

Last updated: 2026-09-05

This file records evidence, not intent. Do not turn TODO / UNVERIFIED into PASS without running the gate.

## Current Review release

- Review source branch: `integrate-production-workspace`
- Fixed Review Worker: `cijd-design-billing-preview`
- Fixed Review URL: `https://cijd-design-billing-preview.hrk-freelance.workers.dev`
- Rollback commit before DAISHIN UI/UX overhaul: `75127f75cc3307109ccd558c56192c703fb681c7`
- Overhaul review head before merge: `1397cabf38abf2d8ea95a325570353da5503df9e`
- Production/main infrastructure: untouched
- Supabase data/schema: unchanged by this UI review release

| Gate | Status | Evidence |
| --- | --- | --- |
| Print cost DB migration | PASS | Supabase migration `20260902083529 print_cost_billing_pricing` is applied on `dldfhhcechzhkbvlnzld` |
| Pricing rule DB check | PASS | cost 10→20, 20→40, 30→55, 100→170, 120→180 verified against DB function |
| UI/API implementation | IMPLEMENTED / TEST PENDING | modal editing, FIFO queues, full-card targets, cost/billing split, final billing override added in source |
| Overhaul typecheck | PASS | GitHub Actions verification on review branch |
| Overhaul changed-file lint | PASS | GitHub Actions verification on review branch |
| Overhaul vinext build | PASS | GitHub Actions verification on review branch |
| Full automated tests | UNVERIFIED | run `npm test` and `npm run test:release` where required |
| Review deploy | PENDING LIVE VERIFICATION | Cloudflare Workers native Git integration owns deployment from `integrate-production-workspace` |
| Canonical Review URL | PENDING LIVE VERIFICATION | `https://cijd-design-billing-preview.hrk-freelance.workers.dev` |
| `/api/version` live match | PENDING LIVE VERIFICATION | must equal current `integrate-production-workspace` HEAD |
| Production Worker | UNTOUCHED | no production deploy authorized |
| Netlify | UNTOUCHED | no Netlify operation authorized |
| `main` | UNTOUCHED | review work belongs on `integrate-production-workspace` |

## Permanent deployment operation

- Cloudflare Workers native Git integration is the canonical automated path.
- Do not add a routine GitHub Actions deploy that requires `CLOUDFLARE_API_TOKEN`.
- Fixed Review URL follows `integrate-production-workspace`.
- Significant work may happen on `review/*` branches, then merge into the Review source after checks.
- Record the previous `integrate-production-workspace` SHA before every Review merge so rollback is immediate.
- See `docs/CLOUDFLARE_PREVIEW_OPERATION.md` and `docs/CANONICAL_OPERATION.md`.

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
- [x] Shared Sheet motion/close/focus behavior upgraded for the DAISHIN-inspired review.
- [x] `wrangler.jsonc` explicitly enables Workers preview URLs.

## Do not claim completion yet when any gate below is unresolved

A release is fully complete only when CODE PASS, DEPLOY PASS and LIVE PASS are all independently verified. If `/api/version` does not match the current Review source HEAD, the required wording is:

`DO NOT CLAIM LIVE COMPLETE`
