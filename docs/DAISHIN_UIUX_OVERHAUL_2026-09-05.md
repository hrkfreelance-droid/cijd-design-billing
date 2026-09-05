# CIJD × DAISHIN UI/UX Overhaul — 2026-09-05

## Purpose

Rebuild CIJD's interaction layer using the best current interaction patterns from DAISHIN while keeping CIJD's real data, Supabase schema, business rules, API contracts, permissions, workflows, typography, and product identity intact.

This is a UI/UX refactor, not a data migration and not a DAISHIN business-logic port.

## Canonical source

- CIJD repository: `hrkfreelance-droid/cijd-design-billing`
- Base branch: `integrate-production-workspace`
- Overhaul branch: `review/daishin-uiux-overhaul-20260905`
- DAISHIN reference repository: `hrkfreelance-droid/daishin-order-v2`
- DAISHIN reference branch: `review/flow-check-20260905`

## Absolute preservation rules

Do not modify, reset, replace, reseed, truncate, rename, or migrate CIJD production data as part of this UI overhaul.

Preserve without behavioral changes:

- Supabase project/database and all existing records
- table names, columns, RLS, auth and roles unless a pre-existing CIJD bug requires a separately approved fix
- API request/response contracts
- existing project, billing, printing, delivery, invoice, payment and archive state transitions
- existing real client/project/item data
- existing exchange-rate/NBC behavior
- existing import/history behavior
- existing CIJD English typography/font stack
- current status semantics and CIJD terminology
- all current URLs/routes unless a route change is explicitly necessary and backward-compatible

Never copy DAISHIN database schema, auth model, customer/order data model, migrations, secrets, environment variables, or operational business rules into CIJD.

## UX reference principles to port from DAISHIN

Port interaction quality, not product identity.

### 1. Motion system

Use a single restrained motion system similar to DAISHIN's current iOS-style interaction tokens:

- primary easing: `cubic-bezier(0.32, 0.72, 0, 1)`
- soft easing: `cubic-bezier(0.22, 0.61, 0.36, 1)`
- fast press feedback
- subtle 4–10px movement, not decorative travel
- no animation that delays an operational action
- support `prefers-reduced-motion`

Create one source of truth for motion tokens and use it across dialogs, sheets, menus, cards, feedback and transitions.

### 2. Modal / sheet behavior

Upgrade the current CIJD `Sheet` system instead of creating many unrelated modal implementations.

Desktop:

- centered compact dialog
- materialized scale/fade entrance
- restrained blur/scrim
- visible close control when appropriate
- Escape closes when safe
- focus enters dialog correctly and returns to the invoking control on close

Mobile/tablet:

- bottom-sheet behavior
- rounded top corners
- drag/grabber affordance
- sheet occupies most of viewport without hiding critical footer actions
- content area scrolls independently
- keyboard does not destroy layout
- body/background scrolling is reliably locked
- closing feels continuous rather than disappearing instantly
- safe-area handling must not create a large empty bottom band

Nested flows such as Project → Item edit must feel like one continuous focused workflow. Avoid a visual pile of unrelated floating modals.

### 3. Workflow pattern

Default operational pattern:

`Queue/List → whole card/row click → focused detail sheet → edit/action → save/complete → close → return to same list position`

Requirements:

- whole meaningful card/row is clickable
- no duplicate actions in both list and sheet
- one obvious primary action per decision state
- secondary/destructive actions visually separated
- after closing a sheet, preserve search/filter/tab/scroll state
- FIFO ordering remains unchanged where already specified
- successful state-changing actions give immediate restrained feedback
- loading, empty, error and disabled states must be explicit

### 4. Information hierarchy

Keep CIJD compact and operational:

- page title + compact summary amount
- search + one primary create action
- project container → flat divider-led item rows
- avoid card-inside-card nesting unless it represents a real conceptual boundary
- align Design and Printing visual grammar
- increase spacing only where it improves decision clarity; do not make desktop pages oversized
- retain CIJD typography; DAISHIN typography is not canonical here

### 5. Touch / responsive quality

- important interactive targets minimum ~44px on touch devices
- prevent iOS focus zoom on form controls
- no horizontal page overflow on iPhone/iPad
- modal/sheet footer remains reachable with software keyboard open
- hover must never be required for understanding or operating the app
- desktop remains information-dense and efficient

## Priority implementation areas

### P0 — shared interaction foundation

Review and improve:

- `src/app/globals.css`
- `src/components/ui.tsx`
- `src/components/shell.tsx`

Add shared motion/scroll-lock helpers only if they reduce duplication.

### P1 — project flow

Review and improve:

- `src/app/designer/projects/page.tsx`
- `src/components/project-editor-modal.tsx`
- `src/components/billing-item-card.tsx`

Target flow:

`Designing → Project sheet → Item sheet → save/complete → Project sheet/list`

Preserve every current project/item API call and billing/print-price rule.

### P1 — Printing flow

Review and improve:

- `src/components/printing-workspace.tsx`
- related delivery/print-cost UI

Make Design and Printing feel like sibling workspaces with the same queue grammar and modal behavior.

### P1 — Office/Billing/Accounting flow

Review:

- `src/components/admin-workspace.tsx`
- `src/components/invoice-sheet.tsx`
- invoice/payment/archive screens and rows

Do not merge different accounting actions merely for visual simplicity. Preserve business-state safety.

### P2 — completion feedback and micro-interactions

Add restrained success/completion feedback inspired by DAISHIN only where an action changes a meaningful workflow state. Do not add confetti, decorative particles, or slow transitions.

## Existing CIJD invariants remain authoritative

`docs/UI_WORKFLOW_INVARIANTS.md` stays authoritative. This overhaul extends it; it does not override its data, billing, printing or FIFO rules.

In particular:

- PRINT cost and customer billing remain separate facts
- PRINT cost confirmation is required before delivery advances to Ready to Invoice
- quantity × price remains bidirectional
- project/item facts remain editable before invoicing
- Design and Printing remain sibling workspaces

## Verification gates

Before calling any implementation complete, run separately and report separately:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run build`
4. relevant Playwright tests via `npm test`
5. import/history/auth/release guards where affected
6. review deployment using the repository's existing review-deploy path
7. live preview visual check at desktop width
8. iPhone-size viewport check
9. iPad/tablet-size viewport check
10. keyboard/open-sheet behavior check on mobile viewport

## Regression scenarios that must remain valid

- New Project
- Add/Edit billing item
- DESIGN price edit
- PRINT internal cost edit
- quantity/unit/total linked calculation
- cost confirmation
- Deliver
- Ready to Invoice
- Mark as Invoiced
- payment completion
- archive/history access
- project title edit
- search/filter behavior
- locale behavior
- auth/role access
- exchange-rate display/refresh

## Forbidden shortcuts

- Do not replace the app with static mock data.
- Do not create a parallel fake UI disconnected from Supabase.
- Do not reset data to make tests pass.
- Do not change production data during visual verification.
- Do not rewrite unrelated backend code.
- Do not rename CIJD terminology to DAISHIN terminology.
- Do not copy DAISHIN migrations/schema/auth.
- Do not touch `main` during this overhaul.
- Do not deploy to production until review preview is verified and explicitly approved.

## Completion report format

Report:

- branch and commit
- changed files
- UI/UX changes by workspace
- data/backend changes: expected `none` unless explicitly approved
- typecheck result
- lint result
- build result
- Playwright result
- review preview URL
- desktop check
- iPhone check
- iPad check
- remaining issues / unverified items
