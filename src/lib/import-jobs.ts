// Import-job lifecycle. Mirrors the SyncJob pattern:
//  - Each upload creates an Import row immediately (status=uploaded).
//  - The parsed products are persisted as ImportRow rows.
//  - "Push to Shopify" kicks off a background task that updates Import.status,
//    Import.currentCount, and each ImportRow.pushStatus/pushError as it runs.
//  - The UI polls /api/imports/:id/status; state survives navigation/logout.

import { Prisma } from "@prisma/client";

import { getPrismaClient } from "@/lib/prisma";
import { ensureSchemaCompatibility } from "@/lib/schema-bootstrap";
import { pushParsedProducts } from "@/lib/import-push";
import { pushParsedCollections } from "@/lib/collections-push";
import type { ParsedProduct } from "@/lib/import-parser";
import type { ParsedCollection } from "@/lib/collections-import-parser";

export type ImportJobStatus = "uploaded" | "processing" | "pushing" | "completed" | "failed";
export type ImportKind = "products" | "collections";

export type ImportJob = {
  id: string;
  storeId: string;
  fileName: string | null;
  importType: ImportKind;
  status: ImportJobStatus;
  phase: string;
  currentCount: number;
  totalRows: number;
  validRows: number;
  errorRows: number;
  message: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
};

type RawImport = {
  id: bigint;
  storeId: bigint;
  fileName: string | null;
  importType: string | null;
  status: ImportJobStatus;
  phase: string;
  currentCount: number;
  totalRows: number;
  validRows: number;
  errorRows: number;
  message: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
};

// Columns selected for every ImportJob read. Kept in one place so all queries
// stay in sync (including the importType added for collections imports).
const IMPORT_SELECT = Prisma.sql`id, storeId, fileName, importType, status, phase, currentCount, totalRows, validRows, errorRows, message, createdAt, updatedAt, finishedAt`;

function toApi(row: RawImport): ImportJob {
  return {
    id: row.id.toString(),
    storeId: row.storeId.toString(),
    fileName: row.fileName,
    importType: row.importType === "collections" ? "collections" : "products",
    status: row.status,
    phase: row.phase,
    currentCount: Number(row.currentCount),
    totalRows: Number(row.totalRows),
    validRows: Number(row.validRows),
    errorRows: Number(row.errorRows),
    message: row.message,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt
  };
}

const RUNNING_STATUSES = ["uploaded", "processing", "pushing"];
const STALE_HEARTBEAT_MS = 90_000;
const RETENTION_DAYS = 7;
const PURGE_THROTTLE_MS = 60 * 60 * 1000; // run the deep purge at most once per hour
let lastPurgeAt = 0;

// Drop imports older than RETENTION_DAYS and their child rows. Throttled so we
// don't issue these DELETEs on every status poll.
async function purgeOldImports(storeId: bigint) {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_THROTTLE_MS) return;
  lastPurgeAt = now;
  const db = getPrismaClient();
  // ImportRow has no Prisma relation back to Import in our schema, so delete
  // it first by joining on the old import ids.
  await db.$executeRaw(
    Prisma.sql`DELETE ir FROM \`ImportRow\` ir
               INNER JOIN \`Import\` i ON i.id = ir.importId
               WHERE i.storeId = ${storeId}
                 AND i.createdAt < (NOW(3) - INTERVAL ${RETENTION_DAYS} DAY)`
  );
  await db.$executeRaw(
    Prisma.sql`DELETE FROM \`Import\`
               WHERE storeId = ${storeId}
                 AND createdAt < (NOW(3) - INTERVAL ${RETENTION_DAYS} DAY)`
  );
}

async function reapStale(storeId: bigint) {
  const db = getPrismaClient();
  await db.$executeRaw(
    Prisma.sql`UPDATE \`Import\`
               SET \`status\` = 'failed',
                   \`message\` = COALESCE(NULLIF(\`message\`,''), 'Import did not complete (worker stopped)'),
                   \`finishedAt\` = NOW(3),
                   \`updatedAt\` = NOW(3)
               WHERE storeId = ${storeId}
                 AND status IN ('processing','pushing')
                 AND updatedAt < (NOW(3) - INTERVAL ${STALE_HEARTBEAT_MS / 1000} SECOND)`
  );
}

export async function createImport(params: {
  storeId: bigint;
  userId: bigint | null;
  fileName: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  message?: string;
  importType?: ImportKind;
}): Promise<bigint> {
  await ensureSchemaCompatibility();
  const db = getPrismaClient();
  const created = await db.import.create({
    data: {
      storeId: params.storeId,
      userId: params.userId ?? null,
      fileName: params.fileName,
      importType: "products",
      status: "uploaded",
      totalRows: params.totalRows,
      validRows: params.validRows,
      errorRows: params.errorRows
    }
  });
  // Set importType via raw SQL so we don't depend on the generated Prisma enum
  // (the 'collections' value may not be in the client until `prisma generate`).
  if (params.importType && params.importType !== "products") {
    await db.$executeRaw(
      Prisma.sql`UPDATE \`Import\` SET \`importType\` = ${params.importType} WHERE \`id\` = ${created.id}`
    );
  }
  if (params.message) {
    await db.$executeRaw(
      Prisma.sql`UPDATE \`Import\` SET \`message\` = ${params.message}, \`updatedAt\` = NOW(3) WHERE \`id\` = ${created.id}`
    );
  }
  return created.id;
}

export async function writeImportRows(
  importId: bigint,
  products: ParsedProduct[]
): Promise<void> {
  await ensureSchemaCompatibility();
  const db = getPrismaClient();
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    await db.$executeRaw(
      Prisma.sql`INSERT INTO \`ImportRow\` (importId, rowNumber, handle, sku, title, rowData, validationStatus, validationErrors, actionType, pushStatus, createdAt)
                 VALUES (
                   ${importId},
                   ${i + 1},
                   ${p.handle},
                   ${p.variants[0]?.sku ?? null},
                   ${p.title ?? null},
                   ${JSON.stringify(p)},
                   'valid',
                   NULL,
                   'create_product',
                   'pending',
                   NOW(3)
                 )`
    );
  }
}

// Persist parsed collection rows for a collections import. We reuse the
// product-shaped ImportRow columns: handle = collection handle, title =
// collection title, and sku carries the Collection ID (collections have no SKU)
// so the per-row UI/CSV can show which collection each row targets.
export async function writeCollectionImportRows(
  importId: bigint,
  collections: ParsedCollection[]
): Promise<void> {
  await ensureSchemaCompatibility();
  const db = getPrismaClient();
  for (let i = 0; i < collections.length; i++) {
    const c = collections[i];
    await db.$executeRaw(
      Prisma.sql`INSERT INTO \`ImportRow\` (importId, rowNumber, handle, sku, title, rowData, validationStatus, validationErrors, actionType, pushStatus, createdAt)
                 VALUES (
                   ${importId},
                   ${i + 1},
                   ${c.handle ?? null},
                   ${c.id},
                   ${c.title ?? null},
                   ${JSON.stringify(c)},
                   'valid',
                   NULL,
                   'update_product',
                   'pending',
                   NOW(3)
                 )`
    );
  }
}

export async function loadImportCollections(importId: bigint): Promise<ParsedCollection[]> {
  const db = getPrismaClient();
  const rows = await db.$queryRaw<{ rowData: Prisma.JsonValue }[]>(
    Prisma.sql`SELECT rowData FROM \`ImportRow\` WHERE importId = ${importId} ORDER BY rowNumber ASC`
  );
  const out: ParsedCollection[] = [];
  for (const r of rows) {
    if (r.rowData && typeof r.rowData === "object") {
      out.push(r.rowData as unknown as ParsedCollection);
    }
  }
  return out;
}

export async function getImport(id: bigint): Promise<ImportJob | null> {
  await ensureSchemaCompatibility();
  const db = getPrismaClient();
  const rows = await db.$queryRaw<RawImport[]>(
    Prisma.sql`SELECT ${IMPORT_SELECT}
               FROM \`Import\` WHERE id = ${id} LIMIT 1`
  );
  return rows[0] ? toApi(rows[0]) : null;
}

export async function getLatestImportForStore(storeId: bigint): Promise<ImportJob | null> {
  await ensureSchemaCompatibility();
  await reapStale(storeId);
  await purgeOldImports(storeId);
  const db = getPrismaClient();
  const rows = await db.$queryRaw<RawImport[]>(
    Prisma.sql`SELECT ${IMPORT_SELECT}
               FROM \`Import\` WHERE storeId = ${storeId} ORDER BY id DESC LIMIT 1`
  );
  return rows[0] ? toApi(rows[0]) : null;
}

export async function listImportsForStore(storeId: bigint, limit = 25): Promise<ImportJob[]> {
  await ensureSchemaCompatibility();
  await reapStale(storeId);
  await purgeOldImports(storeId);
  const db = getPrismaClient();
  const rows = await db.$queryRaw<RawImport[]>(
    Prisma.sql`SELECT ${IMPORT_SELECT}
               FROM \`Import\` WHERE storeId = ${storeId} ORDER BY id DESC LIMIT ${limit}`
  );
  return rows.map(toApi);
}

export async function hasRunningImport(storeId: bigint): Promise<boolean> {
  await reapStale(storeId);
  const db = getPrismaClient();
  const rows = await db.$queryRaw<{ count: bigint }[]>(
    Prisma.sql`SELECT COUNT(*) AS count FROM \`Import\`
               WHERE storeId = ${storeId} AND status IN ('processing','pushing')`
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function updateImport(
  importId: bigint,
  patch: {
    status?: ImportJobStatus;
    phase?: string;
    current?: number;
    valid?: number;
    error?: number;
    message?: string;
    finished?: boolean;
  }
) {
  const db = getPrismaClient();
  const sets: Prisma.Sql[] = [];
  if (patch.status !== undefined) sets.push(Prisma.sql`\`status\` = ${patch.status}`);
  if (patch.phase !== undefined) sets.push(Prisma.sql`\`phase\` = ${patch.phase}`);
  if (patch.current !== undefined) sets.push(Prisma.sql`\`currentCount\` = ${patch.current}`);
  if (patch.valid !== undefined) sets.push(Prisma.sql`\`validRows\` = ${patch.valid}`);
  if (patch.error !== undefined) sets.push(Prisma.sql`\`errorRows\` = ${patch.error}`);
  if (patch.message !== undefined) sets.push(Prisma.sql`\`message\` = ${patch.message}`);
  if (patch.finished) sets.push(Prisma.sql`\`finishedAt\` = NOW(3)`);
  sets.push(Prisma.sql`\`updatedAt\` = NOW(3)`);
  await db.$executeRaw(Prisma.sql`UPDATE \`Import\` SET ${Prisma.join(sets, ", ")} WHERE \`id\` = ${importId}`);
}

async function updateImportRowOutcome(
  importId: bigint,
  rowNumber: number,
  outcome: { ok: boolean; message: string }
) {
  const db = getPrismaClient();
  await db.$executeRaw(
    Prisma.sql`UPDATE \`ImportRow\`
               SET \`pushStatus\` = ${outcome.ok ? "ok" : "error"},
                   \`pushError\` = ${outcome.ok ? null : outcome.message}
               WHERE importId = ${importId} AND rowNumber = ${rowNumber}`
  );
}

export async function loadImportProducts(importId: bigint): Promise<ParsedProduct[]> {
  const db = getPrismaClient();
  const rows = await db.$queryRaw<{ rowData: Prisma.JsonValue }[]>(
    Prisma.sql`SELECT rowData FROM \`ImportRow\` WHERE importId = ${importId} ORDER BY rowNumber ASC`
  );
  const out: ParsedProduct[] = [];
  for (const r of rows) {
    if (r.rowData && typeof r.rowData === "object") {
      out.push(r.rowData as unknown as ParsedProduct);
    }
  }
  return out;
}

export async function cancelImport(importId: bigint): Promise<void> {
  await ensureSchemaCompatibility();
  await updateImport(importId, {
    status: "failed",
    phase: "cancelled",
    message: "Cancelled by user",
    finished: true
  });
}

// Collections branch of the background push. Same lifecycle as the product
// path (per-row outcomes + progress), but dispatches to pushParsedCollections.
async function pushCollectionsImport(importId: bigint, storeId: bigint) {
  const collections = await loadImportCollections(importId);
  if (collections.length === 0) {
    await updateImport(importId, {
      status: "failed",
      phase: "done",
      message: "No collections to push",
      finished: true
    });
    return;
  }
  const result = await pushParsedCollections(storeId, collections, {
    onProgress: async (p) => {
      await updateImportRowOutcome(importId, p.index + 1, { ok: p.outcome.ok, message: p.outcome.message });
      await updateImport(importId, {
        current: p.index + 1,
        valid: p.ok,
        error: p.failed,
        message: `Pushed ${p.index + 1}/${p.total} — ok=${p.ok} failed=${p.failed}`
      });
    },
    shouldCancel: async () => {
      const job = await getImport(importId);
      return !job || job.status === "failed";
    }
  });
  const failed = result.totals.failed;
  const ok = result.totals.ok;
  const finalStatus: ImportJobStatus = failed === 0 ? "completed" : ok === 0 ? "failed" : "completed";
  await updateImport(importId, {
    status: finalStatus,
    phase: "done",
    current: ok + failed,
    valid: ok,
    error: failed,
    message:
      failed === 0
        ? `Updated ${ok} collection(s) successfully.`
        : `Updated ${ok} collection(s). ${failed} failed — download error report for details.`,
    finished: true
  });
}

// Fire-and-forget background push for a stored import.
export function startImportPush(importId: bigint, storeId: bigint) {
  const heartbeat = setInterval(() => {
    void updateImport(importId, {}).catch(() => {});
  }, 20_000);

  setImmediate(async () => {
    try {
      await updateImport(importId, { status: "pushing", phase: "pushing", message: "Pushing to Shopify…" });

      const job = await getImport(importId);
      if (job?.importType === "collections") {
        await pushCollectionsImport(importId, storeId);
        return;
      }

      const products = await loadImportProducts(importId);
      if (products.length === 0) {
        await updateImport(importId, {
          status: "failed",
          phase: "done",
          message: "No products to push",
          finished: true
        });
        return;
      }
      const result = await pushParsedProducts(storeId, products, {
        onProgress: async (p) => {
          await updateImportRowOutcome(importId, p.index + 1, p.outcome);
          await updateImport(importId, {
            current: p.index + 1,
            valid: p.ok,
            error: p.failed,
            message: `Pushed ${p.index + 1}/${p.total} — ok=${p.ok} failed=${p.failed}`
          });
        },
        shouldCancel: async () => {
          const job = await getImport(importId);
          return !job || job.status === "failed";
        }
      });
      const failed = result.totals.failed;
      const ok = result.totals.ok;
      const finalStatus: ImportJobStatus = failed === 0 ? "completed" : ok === 0 ? "failed" : "completed";
      await updateImport(importId, {
        status: finalStatus,
        phase: "done",
        current: ok + failed,
        valid: ok,
        error: failed,
        message:
          failed === 0
            ? `Pushed ${ok} product(s) successfully.`
            : `Pushed ${ok} product(s). ${failed} failed — download error report for details.`,
        finished: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Push failed";
      try {
        await updateImport(importId, { status: "failed", phase: "done", message, finished: true });
      } catch {
        // best-effort
      }
      console.error("[import-job] failed:", error);
    } finally {
      clearInterval(heartbeat);
    }
  });
}

export type ImportRowDetail = {
  rowNumber: number;
  handle: string | null;
  sku: string | null;
  title: string | null;
  pushStatus: "pending" | "ok" | "error";
  pushError: string | null;
};

export async function listImportRowDetails(importId: bigint, opts: { onlyErrors?: boolean } = {}): Promise<ImportRowDetail[]> {
  await ensureSchemaCompatibility();
  const db = getPrismaClient();
  const whereError = opts.onlyErrors ? Prisma.sql`AND pushStatus = 'error'` : Prisma.empty;
  const rows = await db.$queryRaw<
    {
      rowNumber: number;
      handle: string | null;
      sku: string | null;
      title: string | null;
      pushStatus: "pending" | "ok" | "error";
      pushError: string | null;
    }[]
  >(
    Prisma.sql`SELECT rowNumber, handle, sku, title, pushStatus, pushError
               FROM \`ImportRow\` WHERE importId = ${importId} ${whereError}
               ORDER BY rowNumber ASC`
  );
  return rows;
}
