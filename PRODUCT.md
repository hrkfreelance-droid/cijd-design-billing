# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js 16 App Router + TypeScript, local JSON mode, Supabase repository/RLS/functions, and Telegram long polling

## Users

The seed metadata includes Hiroki (DESIGNER), Billing Staff (BILLING), Accounting (ACCOUNTING), and Admin (ADMIN).

## Product Purpose

CIJD DESIGN Billing is an internal workspace for managing multiple clients from project registration through billing, payment confirmation, and archive. Success means a staff member can see the next action quickly and cannot accidentally bill or confirm payment for the same item twice.

## Positioning

The product separates projects from immutable billing items. Add-on work becomes a new item, while invoiced and paid items remain in history and are excluded from future billing candidates.

## Operating Context

Designer uses `/designer` for Today → Projects → Delivered → Archive. Billing and Accounting use `/office` for Billing → Payments → Archive. Project registration and delivery intake are also available through the authenticated Telegram endpoint and long-polling runner.

## Capabilities and Constraints

- Designer destinations are Today, Projects, Delivered, Archive; Office destinations are Billing, Payments, Archive.
- Billing states: IN_PROGRESS, READY_TO_INVOICE, INVOICED, PAID, NEEDS_REVIEW.
- Invoice numbers are manually entered in the MVP and duplicate invoice numbers are rejected.
- Payment confirmation is idempotency-safe: a PAID invoice cannot be confirmed again.
- Local JSON mode must work without Supabase credentials. With credentials, Supabase is the shared production ledger.
- Unconfirmed historical facts remain NEEDS_REVIEW; unknown invoice numbers or dates are stored as null when the billing/payment fact is confirmed.
- Invoice PDF, attachments, accounting integrations, and analytics are intentionally not implemented yet.

## Brand Commitments

CIJD DESIGN is the product name. The service is labeled Billing. Ringer Hut is a real client record supplied for this MVP; no demo or dummy records are seeded.

## Evidence on Hand

The implementation brief and the user-supplied RH Kids Promotion record are the confirmed sources for this build. Ringer Hut historical 2–8 month records were not available in the current workspace, so they were not fabricated.

## Product Principles

- Show the next useful action before the full record.
- Keep project context and billable items distinct.
- Preserve history over destructive edits.
- Make duplicate billing and payment hard to perform.
- Keep the same workflow legible on desktop and phone.

## Accessibility & Inclusion

Use visible labels, keyboard focus states, semantic buttons and dialogs, at least 44px touch targets, reduced motion support, and readable contrast in light and dark themes.
