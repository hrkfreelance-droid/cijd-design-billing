# CIJD Release Status

Last updated: 2026-09-02

This file records evidence, not intent. Do not turn TODO / UNVERIFIED into PASS without running the gate.

| Gate | Status | Evidence |
| --- | --- | --- |
| Print cost DB migration | PASS | Supabase migration `20260902083529 print_cost_billing_pricing` is applied on `dldfhhcechzhkbvlnzld` |
| Pricing rule DB check | PASS | cost 10→20, 20→40, 30→55, 100→170, 120→180 verified against DB function |
| UI/API implementation | IMPLEMENTED / TEST PENDING | modal editing, FIFO queues, full-card targets, cost/billing split, final billing override added in source |
| Typecheck | UNVERIFIED | run `npm run typecheck` |
| Automated tests | UNVERIFIED | run `npm test` and `npm run test:release` |
| vinext build | UNVERIFIED | run `npm run build:vinext` |
| Review deploy | UNVERIFIED | only `npm run deploy:review` is permitted |
| Canonical Review URL | UNVERIFIED | expected fixed URL: `https://cijd-design-billing-preview.hrk-freelance.workers.dev` |
| `/api/version` live match | UNVERIFIED | run `npm run verify:live` |
| Production Worker | UNTOUCHED | no production deploy authorized |
| Netlify | UNTOUCHED | no Netlify operation authorized |
| `main` | UNTOUCHED | work belongs only on `integrate-production-workspace` |

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

A release is fully complete only when CODE PASS, DEPLOY PASS and LIVE PASS are all independently verified. If `npm run verify:live` fails, the required wording is:

`DO NOT CLAIM LIVE COMPLETE`
