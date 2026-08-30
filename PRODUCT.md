# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: Next.js + TypeScript with local mock data mode, keeping the data access boundary ready for Supabase

## Users

Assumption from the implementation brief: Hiroki, Billing Staff, and Accounting. They need a calm, shared view of projects, invoiceable line items, payment status, and history.

## Product Purpose

CIJD DESIGN Billing is an internal workspace for managing multiple clients from project registration through billing, payment confirmation, and archive. Success means a staff member can see the next action quickly and cannot accidentally bill or confirm payment for the same item twice.

## Positioning

The product separates projects from immutable billing items. Add-on work becomes a new item, while invoiced and paid items remain in history and are excluded from future billing candidates.

## Operating Context

The primary workflow is Today → Projects → Billing → Archive. A global client selector filters the workspace. Future project registration may come from Telegram through `POST /api/projects`, but the Bot is out of scope for this MVP.

## Capabilities and Constraints

- Four primary destinations only: Today, Projects, Billing, Archive.
- Billing states: IN_PROGRESS, READY_TO_INVOICE, INVOICED, PAID, NEEDS_REVIEW.
- Invoice numbers are manually entered in the MVP and duplicate invoice numbers are rejected.
- Payment confirmation is idempotency-safe: a PAID invoice cannot be confirmed again.
- Local data mode must work without Supabase credentials. Supabase is a future adapter, not a production connection in this MVP.
- Invoice PDF, attachments, Telegram Bot, notifications, accounting integrations, and analytics are intentionally not implemented yet.

## Brand Commitments

CIJD DESIGN is the product name. The service is labeled Billing. Ringer Hut is only allowed as demo data, never as product identity or business logic.

## Evidence on Hand

The implementation brief is the only confirmed product source. Historical client records and real production billing data are not available for this build and must not be fabricated.

## Product Principles

- Show the next useful action before the full record.
- Keep project context and billable items distinct.
- Preserve history over destructive edits.
- Make duplicate billing and payment hard to perform.
- Keep the same workflow legible on desktop and phone.

## Accessibility & Inclusion

Use visible labels, keyboard focus states, semantic buttons and dialogs, at least 44px touch targets, reduced motion support, and readable contrast in light and dark themes.
