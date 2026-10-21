# BTT Stock Management (starter implementation)

Thai-language inventory web app starter using **Cloudflare Workers + D1**. This repository is the first development increment, not yet a production deployment.

## Included in this increment

- Responsive Thai UI for dashboard, asset registry, approvals, movement history, reports, and settings.
- Worker API for dashboard, asset listing/creation, stock adjustment, stock transfer, immediate transactions for items that do not require approval, approval requests/decisions for flagged items, borrow returns, categories, and movement history.
- D1 schema and indexes in `migrations/0001_initial.sql`.
- Google sign-in architecture through **Cloudflare Access configured with Google as its identity provider**, with Access JWT verification in the Worker and a D1 allowlist/role check.
- Excel normalization/validation script for the existing `Asset`, `Categories`, and `Locations` sheets.
- CSV export usable with Excel. PDF and richer report templates remain a later increment.

## Important design behavior

- `TOTAL` is the physical stock currently in stock balances, plus items currently on loan (because borrowing reduces the warehouse balance but is tracked in open borrow transactions). The dashboard separately displays active reservations and open loans.
- Available quantity is currently calculated as `max(0, physical stock balances - active reservations - open loan quantity)`. Before production, the team should confirm whether the dashboard's total should include items on loan as a separate derived value; the UI wording reflects that distinction.
- A stock item must be classified as `consumable` or `returnable`. The Excel importer intentionally leaves this classification blank for review; don't assume all items are returnable.
- This starter does not silently sync with Excel. D1 is intended to become the source of truth after the controlled migration.

## Prerequisites

- Node.js supported by current Wrangler
- A Cloudflare account
- Cloudflare Zero Trust / Access configured with Google as an identity provider and an application policy that only admits approved Google accounts

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local development vars file:

   ```bash
   cp .dev.vars.example .dev.vars
   ```

   `DEV_AUTH=true` is a local-only bypass for UI/API development. Do not set it in production.

3. Create a local D1 database and apply migrations:

   ```bash
   npx wrangler d1 migrations apply BTT_STOCK_DB --local
   ```

4. Update `wrangler.jsonc` after creating a D1 database in Cloudflare. Replace `REPLACE_WITH_D1_DATABASE_ID` with the actual database ID and set the Access team domain and audience. Do not deploy until these values and the access policy are configured.

5. Start the local Worker:

   ```bash
   npm run dev
   ```

## Bootstrap an initial admin

After migrations, create a user row using your own allowed email. Example for the local database (replace the email):

```bash
npx wrangler d1 execute btt-stock-management --local --command "INSERT INTO users (id,email,display_name,role) VALUES ('local-admin-1','admin@example.com','Local Admin','admin');"
```

Use a real allowed account for production. Never expose a public endpoint that lets users self-promote to Admin.

## Validate Excel before migration

The provided workbook is included as `BTT-Tools-deploy.xlsx` in the project root. Run:

```bash
python scripts/import_excel.py ./BTT-Tools-deploy.xlsx --preview
python scripts/import_excel.py ./BTT-Tools-deploy.xlsx --write-json ./data/import-review.json
```

The importer reports missing/duplicate IDs and `TOTAL` mismatches. It does not write to a database. Review the output, confirm consumable/returnable type for every item, verify image URLs, and decide how to map the source `สถานที่จัดเก็บ` values to the BTT/TKE stock-location split before generating a production import.

## Current limitations to address before production

- Full edit/archive UI, user/role management UI, admin configuration of per-user transfer permission, and item-level QR label printing are not yet complete.
- Email delivery provider and notification schedule are not configured.
- PDF reports and scheduled overdue notifications are not implemented yet.
- Borrow-return edge cases (especially mixed good/damaged/lost partial returns), atomic stock concurrency handling, and migration/import idempotency need automated tests and hardening before real inventory use.
- Configure Access policies and test JWT verification end-to-end before making the Worker publicly reachable.

## Security notes

- Never commit `.dev.vars`, API tokens, OAuth client secrets, or production database credentials.
- Production should use Access JWT verification plus the `users` allowlist. Local `DEV_AUTH` is only for local development.
- Use parameterized SQL statements for user-provided values.
- Back up/export D1 before production data migrations.
