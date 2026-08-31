# Handoff — Claude UI review pass

## Canonical path

`/Users/hirokitoyoshima/Desktop/CIJD DESIGN Billing/cijd-design-billing`

Branch: `integrate-production-workspace`

- Starting HEAD: `3cc48d4` — *Refine work list status and actions*
- Ending HEAD: see the commit that carries this file (`Polish production billing UI and mobile hierarchy`)

## Goal

Turn the workspace from "functionally correct" into something usable every day:
remove duplicated information, give the lists one alignment grid, put the price
state where the number is, and stop the action buttons from being the loudest
thing on screen. No business logic, schema, auth or role changes.

## How this was reviewed

Production data lives in Supabase and was **never** written to. The five current
projects described in the brief exist only there, so the review ran against a
**local throwaway fixture**:

- a read-only copy of `.data/runtime/db.json` (71 imported historical rows plus
  the real delivered `Correction $15`), plus the nine current operational items
  reconstructed in the scratchpad;
- served by a second dev server on port 3100 with the Supabase env vars blanked
  and `CIJD_DATA_FILE` pointed at the copy.

Nothing in `.data/`, `history.csv` or Supabase was modified. The fixture is not
part of the repo.

## Screens reviewed

Designer: Today, Projects, Project detail, Item sheet, Delivered, Archive.
Printing: Review, Ordering, Delivered, History.
Office: Billing.
Sign-in: development picker and the Supabase email/password form.
Both locales (JA / EN), light theme, at 1440 / 390 / 320.

## Changed files

```
.gitignore
eslint.config.mjs
playwright.config.ts
src/app/globals.css
src/app/designer/page.tsx
src/app/designer/delivered/page.tsx
src/app/designer/projects/page.tsx
src/app/designer/projects/[id]/page.tsx
src/app/signin/page.tsx
src/components/billing-item-card.tsx
src/components/delivery.tsx
src/components/printing-workspace.tsx
src/components/ui.tsx
src/lib/i18n.ts
```

## Visual decisions

**Project grouping.** Kept. The project header now carries name, client, month,
owner and the money, and the separate bottom total row and the header status
pill were removed — the header is the summary, the items carry their own state.

**Billing item hierarchy.** Rebuilt as a two-column grid: status on its own
top-left line, then name / amount, then spec / price-state, then actions. Status
sits on its own line deliberately — inline, a wide label such as
"Ready to Invoice" pushed the name column sideways and every row started at a
different x.

**The amount is printed once.** Previously each row showed `$25` top-right *and*
a `Confirmed $25` chip below it, which read as two competing pills per row. The
chip is gone; certainty is a caption under the amount, and a confirmed price
gets no caption at all because the bare number already means confirmed.

**Type is printed once.** The meta line used to render `Design · Design` and
`Revision · Revision`. It now returns empty when the name already says
everything, and matches the stored type as well as the localised label so
`Print` under `印刷` is caught in Japanese too.

**Status placement / colour.** Small rounded label, top-left, existing semantic
tokens only. Two treatments are kept on purpose: `StatusPill` for actionable
work rows, `StatusTag` (dot + text) for dense read-only reference lists
(Archive, Delivered, Office). Both draw from the same tokens.

**Button sizing.** One height per size (sm 36px, md 40px), one radius, shared
min-width so *Complete* and *Deliver* match beside each other. The old
`min-w-[104px]` plus a `max-sm:w-full` container produced full-bleed blue slabs
on mobile; both are gone.

**Button colours.** A disabled primary now fades to inert grey. It previously
dropped the whole button to 40% opacity, leaving white text on pale blue — the
one place a filled button became unreadable, and the "blue background, dark
text" problem reported in the brief.

**Button hierarchy follows the business rule.** While a price is unconfirmed,
*Review price* is primary and *Complete* / *Deliver* is demoted to secondary.
Price review genuinely precedes production hand-off, and the UI now says so.

**Amount alignment.** Every amount lands in one shared right-hand column with
tabular numerals, on Today, Projects and Project detail alike.

**Suggested vs confirmed.** `Suggested · Review required` /
`Price pending · Review required` in review red under the amount; confirmed
prices are shown plain. Today previously showed suggested prices as if final.

**Print vs creative semantics.** Unchanged and already correct: creative work
Completes, PRINT Delivers, driven by `productionAction()`.

**Estimated vs confirmed total.** A project total is only called *Total* when
every price behind it is confirmed; anything suggested *or* pending makes it
*Estimated Total*. Previously a pending price still read as a hard Total.

**Printing workspace.** The suggested amount was shown twice (headline and spec
grid) — the grid now carries only size, quantity and unit price, the working-out
behind the headline. *Edit specs* and *Edit price* opened the same sheet and are
merged into one button. A card with no price no longer labels the blank
"Suggested", and says what is missing instead of leaving Confirm silently dead.

**Item detail.** Gained a read-only price-review block (state, suggested figure,
unit rate, source, reason) for unconfirmed items, so "Needs review" is
actionable without leaving the screen. Display only — it reads existing fields.

**Navigation.** Already top-based; no bottom nav exists, so there is nothing to
overlap. Left as is.

**Mobile layout.** Vertical stacking rather than horizontal cramming, per the
brief. Rows are taller and nothing truncates at 320.

**Typography / spacing / hairlines.** No new scale. Project titles no longer
shout in uppercase in the list while appearing sentence-case on the detail page.
The one-line hint on project detail lost its panel chrome and is now a caption.

## Accessibility

`--c-faint` was **3.26:1** on white and carries most of the small meta text —
below AA. Changed `#8e8e93` → `#757579` (**4.59:1**). Dark mode already passed
(5.46:1) and is unchanged. All other tokens verified: text 16.8, muted 5.07,
accent 5.57, review 5.44, paid 5.01, awaiting 4.62.

Billing status on the Delivered list was `hidden sm:flex` — invisible on mobile.
Moved into the wrapping meta line so it survives every width.

The Supabase sign-in is now a real `<form>`: Enter submits natively and password
managers can see the credential pair.

## Functional behaviour preserved

No changes to auth, RLS, roles, permissions, invoice logic, payment logic,
delivery gating, price-confirmation rules, or any schema or migration. Role
scoping was verified live: a `PRINTING` user hitting `/designer` is redirected
to `/printing` and sees only printing navigation.

## Bugs fixed in passing

1. **Project detail item rows had no horizontal padding** — text ran to the
   viewport edge and the amount clipped on mobile.
2. **Undoing a completion showed the wrong confirmation copy** — it reused the
   "mark complete" body. Added `production.undoCompleteConfirmBody` (JA + EN).
3. **Today's "In Progress" tile double-counted.** It counted all current work
   including the items already counted under Needs Review. The three tiles now
   partition the queue (4 / 5 / 0 rather than 9 / 4 / 0).
4. **Playwright suite was fully broken** (10 of 11 failing at sign-in) — see
   below.

## Tests

| Command | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npx playwright test` | **PASS — 11/11** (with dev server running) |
| `npm run test:import` | PASS — 6/6 |
| `npm run test:auth` | PASS — 1/1 |

**The Playwright suite was already broken at `3cc48d4`** — verified by stashing
this work and re-running against the clean tree, where it failed identically.
Cause: `.env.local` now holds real Supabase credentials, so the test server
booted in Supabase mode, where the development sign-in the suite depends on is
correctly refused. `playwright.config.ts` now blanks the three Supabase vars for
the test server, keeping the run on its throwaway store as the config always
intended.

It also builds into its own `.next-test` dist dir. It previously shared
`.next-local` with `npm run dev`, and Next refuses to start a second dev server
on the same dist dir — so the suite only passed when no dev server was up. It
now runs either way; verified passing with the dev server on port 3000 live.

No test expectation was weakened.

## Current business data assumptions

- 5 current projects / 9 billing items, all `created_by = Hiroki`.
- `RH Kids Promotion · Correction · $15` is DELIVERED / READY_TO_INVOICE and is
  a **separate** Office billing candidate — not designer active work, and not to
  be merged with the current `Revision $15`.
- 71 imported rows (`created_by = Import`) are historical reference, shown in
  Designer Archive with their original billing facts intact.
- No count is hardcoded anywhere; everything derives from the data.

## Known functional issues (not touched)

1. **A creative item is stored as `DELIVERED`.** The real `Correction $15` has
   `productionStatus = DELIVERED` although it is creative work, which by the
   current rule should be `COMPLETED`. The UI labels it from the stored fact, so
   it reads "Delivered". Correcting the label would misrepresent the record and
   correcting the record would rewrite history — left alone deliberately. Decide
   whether legacy rows get migrated.
2. **Print spec fields are not editable from the designer side.** `printSize`,
   `priceSource`, `priceReason` are visible there but only editable in the
   Printing workspace. Probably correct by role design; confirm it is intended.
3. **`priceState()` infers state from free-text notes** (`includes("suggested")`)
   for rows without an explicit `priceReviewStatus`. Fine as a compatibility
   path, fragile as a long-term rule.

## Tested viewports

1440 × 900, 390 × 844, 320 × 720. Horizontal overflow measured as zero at 390
and 320 (`documentElement.scrollWidth === window.innerWidth`); the only
wider-than-viewport element is the client bar, which scrolls by design.

## Local URLs

- Designer — http://localhost:3000/designer
- Printing — http://localhost:3000/printing
- Office — http://localhost:3000/office
- Sign-in — http://localhost:3000/signin

## Remaining recommendations

1. Decide the legacy `DELIVERED`-creative migration (known issue 1).
2. Move `priceReviewStatus` to always-explicit and retire the note-sniffing
   fallback in `priceState()`.
3. Office and Archive were left largely alone; give them the same amount-column
   and status treatment when convenient.
4. Add a Playwright case asserting *Review price* outranks *Deliver* while a
   price is unconfirmed, so the hierarchy cannot silently regress.

## Do not regress

- Project grouping: one project header, items nested beneath. Never repeat the
  project name per billing item.
- One amount per row. Do not reintroduce a chip that repeats the number.
- No `Confirmed $25` chip on confirmed prices — a plain number means confirmed.
- Status stays on its own line; putting it inline breaks the name column.
- *Review price* stays primary over *Complete* / *Deliver* while a price is
  unconfirmed.
- Creative work Completes; PRINT Delivers. Never "Deliver" a design.
- *Total* only when every price is confirmed; otherwise *Estimated Total*.
- `--c-faint` must stay at or above 4.5:1 on white.
- Buttons keep one height per size and never stretch full-width in a list row.
- Never write review or demo data into Supabase, `.data/`, or `history.csv`.
