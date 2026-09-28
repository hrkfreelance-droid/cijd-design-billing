# CIJD Billing V4 — isolated Preview

This package is an independent application and Worker. It does not import the repository root application, runtime, API routes, or database configuration.

## Runtime boundary

- Worker: `cijd-design-billing-v4-preview`
- API namespace: `/api/v4/*`
- Database: V4-only Cloudflare D1 binding `DB`
- Worker secrets: `V4_ACCESS_TOKEN`, `V4_SESSION_SECRET`
- Migration path: `migrations/`
- Tax Invoice visual baseline: workbook sheet `CIJDTI2026080`
- Historical invoice import: `NEEDS_REVIEW` and intentionally absent

Do not point this package at any existing billing database. The Worker owns the `/api/v4/*` boundary and the D1 binding; the API does not call V3 or an external database. `npm run test:architecture` rejects Supabase references, V3 routes/APIs, and cross-system coupling.

## Verification

```sh
npm run verify
```

The D1 integration test applies the migration to an isolated local Wrangler database, then exercises Customer, Project, Billing Item, Draft, Issue, snapshot freeze, Cancel, Duplicate, and readback through the Worker API.

Deployment is only through this package:

```sh
npm run deploy:preview
```
