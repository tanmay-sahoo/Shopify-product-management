# Shopify Product Management Dashboard


## Included

- Next.js 15 + TypeScript app scaffold
- Tailwind-based dashboard shell and pages
- Shopify OAuth start/callback/logout route handlers
- Prisma schema covering stores, products, variants, imports, media, drafts, and sync logs
- Mock-backed API routes for products, variants, stores, imports, exports, and media mapping
- CSV parsing and validation helpers for horizontal image columns
- Enhanced product export CSV generator with product/admin links and variant image columns

## Routes

- `/connect`
- `/dashboard`
- `/products`
- `/variants`
- `/imports`
- `/media`
- `/drafts`
- `/logs`
- `/settings`

## API surface

- `POST /api/auth/shopify/start`
- `GET /api/auth/shopify/callback`
- `POST /api/auth/logout`
- `GET /api/stores`
- `GET /api/stores/:id`
- `POST /api/stores/:id/sync`
- `GET /api/stores/:id/sync-logs`
- `GET /api/products`
- `GET /api/products/:id`
- `PATCH /api/products/:id`
- `POST /api/products/bulk-update`
- `POST /api/products/export`
- `GET /api/products/export/:exportId`
- `GET /api/variants`
- `PATCH /api/variants/:id`
- `POST /api/variants/bulk-update`
- `POST /api/imports/upload`
- `GET /api/imports`
- `GET /api/imports/:id`
- `POST /api/imports/:id/validate`
- `POST /api/imports/:id/approve`
- `POST /api/imports/:id/push`
- `GET /api/imports/:id/error-report`
- `GET /api/media`
- `POST /api/media/validate`
- `POST /api/media/map-variant-images`

## Local setup

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL`, `APP_URL` (or `SHOPIFY_REDIRECT_URI`), and `TOKEN_ENCRYPTION_KEY`.
3. Run `npm install`.
4. Run `npm run typecheck`.
5. Run `npm run build`.
6. Run `npm run dev`.

Shopify `client_id` and `client_secret` are entered through the `/connect` UI, encrypted, and stored in the database.

## Current limitations

- UI and API responses use mock data, not live MySQL or Redis yet.
- Queue workers and Shopify GraphQL sync/push jobs are scaffolded conceptually but not executed yet.
- Prisma validation requires a real `DATABASE_URL`.
