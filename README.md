# Shopify Product Management Dashboard

Next.js 15 + Prisma + MySQL dashboard for managing Shopify products across multiple stores. Authenticated, OAuth-connected, with a real sync/push pipeline, draft-stage approvals, bulk CSV import/export, linked-inventory sync between variants, and cross-store migration of metafields including reference types.

## Stack

- Next.js 15.5 (App Router, typed routes)
- Prisma 6 with MySQL (Aiven)
- Tailwind CSS
- Shopify Admin GraphQL 2025-10
- Web Crypto HMAC for sessions (Edge-middleware compatible)
- AES-256-CBC for stored access tokens and client secrets
- Schema auto-bootstrapped at runtime via raw DDL (works around `prisma generate` EPERM on Windows)

## Features

### Multi-store OAuth
- Connect any number of Shopify stores. Saved app-credential templates make the second connection one click.
- Active-store switcher in the topbar; per-store sessions cookie-backed.
- Disconnect / delete-forever cascade cleans products, variants, drafts, sync logs.

### Auth
- Default admin from env (`ADMIN_USERNAME` / `ADMIN_PASSWORD`).
- DB-backed user management with scrypt password hashes; users can be created, edited, deleted in Settings → Users.
- Edge-middleware session check; signed `lns_session` cookie.

### Catalog sync
- Full GraphQL sync of products, variants, options, categories, SEO, media, and inventory (with `inventoryItem.id`, weight/measurement, cost, country/HS code, tax/policy/tracker).
- Metafields fetched per-owner with cursor pagination (>50 metafields per product/variant supported).
- Shop currency code captured and used for price formatting throughout the UI.
- Smart-sync on tab focus + optional periodic sync (5/15/30/60 min) via the topbar.

### Webhooks (push from Shopify)
- HMAC-verified handler at `/api/webhooks/shopify/products`.
- Topics auto-registered at OAuth time: `products/create/update/delete`, `inventory_levels/update`, `orders/create`, `orders/paid`, `orders/cancelled`, `refunds/create`.
- Targeted per-product updates instead of full re-syncs.

### Products & variants
- Excel-like products table with search, vendor/type/status filters, expandable variant trees, bulk selection, sticky header, pagination (10–250 per page), and CSV export.
- Variants page with SKU-level price-range filter and sticky header.
- Product editor (single modal): edit title/body/vendor/type/tags/SEO + per-variant SKU/price/compare/inventory/barcode/image. Field-level diff staging into Drafts.

### Drafts (staged changes)
- Every product/variant edit becomes a `DraftChange` row (status: draft/approved/rejected/pushed/failed).
- Drafts board with image, title, variant-options chips, before→after diff, bulk approve/reject/delete/push, selection persists across approve→push.
- Up to 500 active drafts loaded; the dashboard stat shows the true `count(*)`.

### Push to Shopify
- Real GraphQL mutations: `productUpdate`, `productVariantsBulkUpdate`, `inventoryAdjustQuantities`, `productDelete`, `productVariantsBulkDelete`.
- Per-draft success/error reporting; failed drafts retain error messages.

### Bulk import — full round-trip
- Parses Shopify-standard product CSV: Handle, Title, Body (HTML), Vendor, Product Category, Type, Tags, Published, Option1/2/3, Variant SKU/Grams/Inventory Tracker/Qty/Policy/Fulfillment Service/Price/Compare At/Requires Shipping/Taxable/Barcode, Gift Card, SEO Title/Description, Variant Image/Weight Unit/Tax Code, Cost per item, Country of Origin, Harmonized System Code, Status, plus `Product/Variant Metafield: ns.key [type]` columns.
- Duplicate-variant dedupe (same option-tuple rows fold into one variant).
- `Image 1..N` columns read directly into product media.
- Real push pipeline:
  - `productByHandle` lookup → `productCreate` or `productUpdate`.
  - `productSet` (synchronous) for variants with proper `optionValues` schema.
  - `productCreateMedia` uploads every unique image URL (product images + variant-specific images, deduped) and captures the new media GIDs.
  - `productVariantAppendMedia` attaches the right media to each variant by SKU.
  - `metafieldsSet` writes product and variant metafields in batches of 25.
  - `inventorySetQuantities` sets per-variant stock at the primary location.

### Cross-store migration of metafields (including references)
- Export emits three columns per reference-type metafield:
  - `[type]` — raw source-store GID (for same-store re-import).
  - `[display]` — human-readable label (resolved via `nodes(ids:)`).
  - `[ref]` — portable identifier (`metaobject:<type>:<handle>`, `product:<handle>`, `variant:<productHandle>:<sku>`, `collection:<handle>`, `file:<url>`, `page:<handle>`).
- On import to a different store, the push pipeline calls a `DestinationResolver` that looks up each portable key via `metaobjectByHandle`, `products(query:handle:X)`, `collections(query:handle:X)`, etc., and rewrites the value to the destination's GID before `metafieldsSet`.
- Cached per migration so each unique reference is resolved once.

### Export CSV
- Shopify-standard column layout, importable directly via Shopify's Products → Import.
- One row per variant. All product images repeated across every variant row as `Image 1..N` (easier to read) plus per-variant `Variant Image`.
- Trailing `Product URL` and `Admin URL` columns for convenience.
- Dynamic metafield columns include scalar values verbatim and resolved labels for references.

### Linked Inventory Sync (`/inventory-sync`)
Three modes link variants together so stock (and optionally price) stay aligned:
- **Mirror** — one source variant drives many targets (with per-target stock buffer and price multiplier).
- **Shared Pool** — multiple variants share one physical stock pool; any sale syncs all members.
- **Bundle / Combo** — combo stock = `min(floor(component_stock / quantity_required))`; combo sales deduct components, cancellations/refunds restock them.
- Manual *Sync now* and *Dry run* per group, plus *Sync all* / *Dry run all*.
- Webhook-driven auto-sync on `inventory_levels/update`, `products/update`, `orders/create`, `orders/cancelled`, `refunds/create`.
- Loop guard: writes are tagged with a reference URI; subsequent webhook echoes are dropped within a 30-second TTL; idempotent skip-if-equal on every write.
- CSV import/export per mode with row-level validation.
- Auto-map suggestions by SKU, tag, or shared title tokens.

### Stack-level operational details
- All token writes encrypted at rest (`TOKEN_ENCRYPTION_KEY`).
- HMAC verification on every webhook with the store's own client secret.
- Schema-bootstrap migrations: at first request the runtime ensures `Store.displayName`, `Store.currencyCode`, `ShopifyAppCredential`, `InventorySyncGroup`, `InventorySyncGroupItem`, `ProductMetafield`, and `VariantMetafield` tables/columns exist — without needing `prisma generate`.

## Routes

- `/login`
- `/dashboard`
- `/products`
- `/variants`
- `/drafts`
- `/imports`
- `/inventory-sync`
- `/logs`
- `/settings` (tabs: Stores, Connect Store, App Credentials, Users)

## API surface

### Auth
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET  /api/auth/me`
- `POST /api/auth/shopify/start`
- `GET  /api/auth/shopify/callback`

### Stores
- `GET  /api/stores`
- `POST /api/stores/active`
- `POST /api/stores/:id/sync`
- `DELETE /api/stores/:id`

### Products / variants
- `GET  /api/products`
- `PATCH /api/products/:id`
- `POST /api/products/export` (GET also supported)

### Drafts
- `GET  /api/drafts`
- `POST /api/drafts/approve`
- `POST /api/drafts/reject`
- `POST /api/drafts/delete`
- `POST /api/drafts/push`

### Bulk import
- `POST /api/imports/upload` — Shopify-CSV parser, returns structured products + errors
- `POST /api/imports/push-to-shopify` — runs the full create/update/media/metafield/inventory pipeline

### Webhooks
- `POST /api/webhooks/shopify/products` — handles all registered product/inventory/order/refund topics

### App credentials / users
- `GET/POST /api/credentials`, `PATCH/DELETE /api/credentials/:id`
- `GET/POST /api/users`, `PATCH/DELETE /api/users/:id`

### Inventory Sync
- `GET/POST /api/inventory-sync/groups`
- `GET/PATCH/DELETE /api/inventory-sync/groups/:id`
- `POST/PATCH/DELETE /api/inventory-sync/groups/:id/items`
- `POST /api/inventory-sync/groups/:id/sync?dryRun=…`
- `POST /api/inventory-sync/sync-all?dryRun=…`
- `POST /api/inventory-sync/csv-import` (preview + execute)
- `GET  /api/inventory-sync/csv-export?mode=mirror|shared_pool|bundle`
- `GET  /api/inventory-sync/auto-map?by=sku|tag|title`
- `GET  /api/inventory-sync/variants?search=…`

## Local setup

1. Copy `.env.example` to `.env`.
2. Fill in:
   - `DATABASE_URL` — MySQL connection string (Aiven works well).
   - `APP_URL` or `SHOPIFY_REDIRECT_URI` — for OAuth callback.
   - `TOKEN_ENCRYPTION_KEY` — used for AES-256-CBC at-rest encryption.
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD` — built-in admin login (override the defaults).
   - `SHOPIFY_WEBHOOK_URL` — public HTTPS URL receiving webhooks (ngrok or your deployed host).
   - `SHOPIFY_SCOPES` — defaults already cover products, inventory, files, locations, metafields, metaobjects.
3. `npm install`
4. `npm run typecheck`
5. `npm run dev`

Shopify app `client_id` and `client_secret` are entered through Settings → App Credentials, encrypted, and stored.

## Webhook setup

- Set `SHOPIFY_WEBHOOK_URL` to a publicly reachable HTTPS URL pointing at `/api/webhooks/shopify/products` (e.g. an ngrok forwarding to your dev port, or your production host).
- On OAuth connect, the app automatically registers the required topics with that URL.
- For local development, start ngrok with the right port (`ngrok http 3000`), update `SHOPIFY_WEBHOOK_URL` in `.env`, then reconnect the store (or re-register via Settings).

## Operational notes

- Sync time scales with metafields: each product and variant triggers a paginated metafield fetch. For 100 products × 5 variants on a standard Shopify plan (50 points/sec) expect ~1–2 minutes. For very large catalogs, Shopify Bulk Operations is the right next step — not yet built.
- The push pipeline replaces a product's variant set wholesale via `productSet`; variant GIDs change. If you have external systems referencing variant GIDs, account for this.
- Inventory writes use the store's primary online-order location. Multi-location is not yet wired.
- Cross-store reference resolution does NOT auto-create missing metaobject definitions on the destination; create the definitions there first or those metafields will be skipped on import.

## Known limitations

- File and Page references in metafields are stored portably but not yet resolved on cross-store import (skipped silently).
- `productSet` is wholesale-replace for variants; granular variant patches are done via `productVariantsBulkUpdate` only in the drafts-push pipeline.
- Currency conversion across stores is not performed — prices transfer as raw decimal strings.
- Importing back into Shopify's *direct* Products → Import requires regenerating the file with `Image Src` columns; we currently emit `Image 1..N` plus `Variant Image` for our own pipeline. Direct Shopify upload still works for product fields but image attach uses our pipeline.
