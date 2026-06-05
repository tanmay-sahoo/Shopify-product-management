import { Prisma } from "@prisma/client";

import { readActiveStoreId } from "@/lib/active-store";
import { getPrismaClient } from "@/lib/prisma";
import { ensureSchemaCompatibility } from "@/lib/schema-bootstrap";
import type { DraftChange, ImportSummary, Product, StoreSummary, SyncLog, Variant } from "@/lib/types";

async function loadCurrencyCodes(storeIds: bigint[]): Promise<Map<string, string | null>> {
  if (storeIds.length === 0) return new Map();
  const rows = await getPrismaClient().$queryRaw<{ id: bigint; currencyCode: string | null }[]>(
    Prisma.sql`SELECT \`id\`, \`currencyCode\` FROM \`Store\` WHERE \`id\` IN (${Prisma.join(storeIds)})`
  );
  return new Map(rows.map((row) => [String(row.id), row.currencyCode]));
}

function summariseDraft(
  entityType: string,
  changeType: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): string {
  if (after && typeof after === "object") {
    const fields = Object.keys(after);
    if (fields.length > 0) {
      const verb = changeType === "create" ? "Create" : changeType === "delete" ? "Delete" : "Update";
      return `${verb} ${entityType} · ${fields.join(", ")}`;
    }
  }
  if (before && typeof before === "object" && Object.keys(before).length > 0) {
    return `${entityType} ${changeType} (no after data)`;
  }
  return `${entityType} ${changeType}`;
}

function mapStore(record: {
  id: bigint;
  shopDomain: string;
  displayName?: string | null;
  status: "active" | "inactive" | "uninstalled" | "error";
  installedAt: Date | null;
  lastSyncAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
  scopes: string | null;
  currencyCode?: string | null;
}): StoreSummary {
  return {
    id: Number(record.id),
    shopDomain: record.shopDomain,
    displayName: record.displayName ?? null,
    status: record.status,
    installedAt: (record.installedAt ?? record.createdAt).toISOString(),
    lastSyncAt: (record.lastSyncAt ?? record.updatedAt).toISOString(),
    scopes: record.scopes ? record.scopes.split(",").filter(Boolean) : [],
    currencyCode: record.currencyCode ?? null
  };
}

const EMPTY_STATS = {
  totalProducts: 0,
  totalVariants: 0,
  draftChanges: 0,
  importErrors: 0,
  imagesPending: 0,
  lastSyncAt: new Date(0).toISOString()
};

const EMPTY_IMPORT: ImportSummary = {
  id: 0,
  fileName: "",
  status: "uploaded",
  totalRows: 0,
  validRows: 0,
  errorRows: 0,
  warningRows: 0,
  createdAt: new Date(0).toISOString(),
  rows: []
};

export async function listConnectedStores(): Promise<StoreSummary[]> {
  const db = getPrismaClient();
  try {
    await ensureSchemaCompatibility();
    const rows = await db.store.findMany({
      where: { status: { not: "uninstalled" } },
      orderBy: { installedAt: "desc" }
    });
    const currencies = await loadCurrencyCodes(rows.map((row) => row.id));
    return rows.map((row) => mapStore({ ...row, currencyCode: currencies.get(String(row.id)) ?? null }));
  } catch {
    return [];
  }
}

export type DashboardData = {
  stats: typeof EMPTY_STATS;
  products: Product[];
  variants: Variant[];
  importSummary: ImportSummary;
  draftChanges: DraftChange[];
  syncLogs: SyncLog[];
  store: StoreSummary | null;
  stores: StoreSummary[];
  // Set when the database (or schema bootstrap) couldn't be reached, so pages
  // can show a friendly "can't reach database" message instead of letting the
  // raw Prisma error escape the Server Component and leak the connection string.
  dbError?: boolean;
};

const EMPTY_DASHBOARD: DashboardData = {
  stats: EMPTY_STATS,
  products: [],
  variants: [],
  importSummary: EMPTY_IMPORT,
  draftChanges: [],
  syncLogs: [],
  store: null,
  stores: []
};

export async function getDashboardData(): Promise<DashboardData> {
  const db = getPrismaClient();
  try {
    return await loadDashboardData(db);
  } catch (error) {
    console.error("[data-service] database unreachable", error);
    return { ...EMPTY_DASHBOARD, dbError: true };
  }
}

async function loadDashboardData(db: ReturnType<typeof getPrismaClient>): Promise<DashboardData> {
  await ensureSchemaCompatibility();
  const activeId = await readActiveStoreId();
  const allStores = await listConnectedStores();

  const connectedStore = await (async () => {
    try {
      const baseWhere = { status: { not: "uninstalled" as const } };
      const where = activeId
        ? { id: BigInt(activeId), ...baseWhere }
        : { ...baseWhere, status: "active" as const };
      return await db.store.findFirst({
        where,
        orderBy: { updatedAt: "desc" },
        include: {
          products: {
            include: {
              variants: true,
              productImages: { orderBy: { position: "asc" } }
            },
            orderBy: { updatedAt: "desc" }
          },
          syncLogs: { orderBy: { createdAt: "desc" }, take: 50 },
          draftChanges: { orderBy: { createdAt: "desc" }, take: 500 },
          imports: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { rows: { orderBy: { rowNumber: "asc" } } }
          }
        }
      });
    } catch {
      return null;
    }
  })();

  if (!connectedStore) {
    return {
      stats: EMPTY_STATS,
      products: [],
      variants: [],
      importSummary: EMPTY_IMPORT,
      draftChanges: [],
      syncLogs: [],
      store: null,
      stores: allStores
    };
  }

  const liveProducts: Product[] = connectedStore.products.map((product) => ({
    id: Number(product.id),
    handle: product.handle ?? "",
    title: product.title ?? "",
    vendor: product.vendor ?? "",
    productType: product.productType ?? "",
    tags: product.tags ? product.tags.split(",").map((item) => item.trim()).filter(Boolean) : [],
    status: product.status,
    bodyHtml: product.bodyHtml ?? "",
    seoTitle: product.seoTitle ?? "",
    seoDescription: product.seoDescription ?? "",
    updatedAt: product.updatedAt.toISOString(),
    images: product.productImages.map((image) => ({
      id: image.shopifyMediaId ?? String(image.id),
      src: image.sourceUrl ?? "",
      alt: image.altText ?? "",
      position: image.position
    })),
    variants: product.variants.map<Variant>((variant) => ({
      id: Number(variant.id),
      productId: Number(variant.productId),
      sku: variant.sku ?? "",
      title: variant.title ?? "",
      option1Value: variant.option1Value ?? "",
      option2Value: variant.option2Value ?? "",
      option3Value: variant.option3Value ?? "",
      price: variant.price ? Number(variant.price) : 0,
      compareAtPrice: variant.compareAtPrice ? Number(variant.compareAtPrice) : undefined,
      inventoryQuantity: variant.inventoryQuantity,
      barcode: variant.barcode ?? "",
      status: product.status,
      variantImages: [],
      updatedAt: variant.updatedAt.toISOString()
    }))
  }));

  const liveVariants = liveProducts.flatMap((product) => product.variants);

  const productDraftIds = connectedStore.draftChanges
    .filter((d) => d.entityType === "product" && d.entityId !== null)
    .map((d) => d.entityId!) as bigint[];
  const variantDraftIds = connectedStore.draftChanges
    .filter((d) => d.entityType === "variant" && d.entityId !== null)
    .map((d) => d.entityId!) as bigint[];

  const draftProducts = productDraftIds.length
    ? await db.product.findMany({
        where: { id: { in: productDraftIds } },
        include: { productImages: { orderBy: { position: "asc" }, take: 1 } }
      })
    : [];
  const draftVariants = variantDraftIds.length
    ? await db.variant.findMany({
        where: { id: { in: variantDraftIds } },
        include: {
          product: { include: { productImages: { orderBy: { position: "asc" }, take: 1 } } }
        }
      })
    : [];

  const draftProductById = new Map(draftProducts.map((p) => [Number(p.id), p]));
  const draftVariantById = new Map(draftVariants.map((v) => [Number(v.id), v]));

  const latestImport = connectedStore.imports[0];
  const parsedImportRows = latestImport
    ? latestImport.rows.map((row) => ({
        rowNumber: row.rowNumber,
        handle: row.handle ?? "",
        sku: row.sku ?? "",
        title:
          typeof row.rowData === "object" && row.rowData && "title" in row.rowData
            ? String((row.rowData as Record<string, unknown>).title ?? "")
            : "",
        price:
          typeof row.rowData === "object" && row.rowData && "price" in row.rowData
            ? String((row.rowData as Record<string, unknown>).price ?? "")
            : "",
        inventory:
          typeof row.rowData === "object" && row.rowData && "inventory" in row.rowData
            ? String((row.rowData as Record<string, unknown>).inventory ?? "")
            : "",
        imageColumns: [],
        validationStatus: row.validationStatus,
        validationErrors: Array.isArray(row.validationErrors) ? (row.validationErrors as string[]) : [],
        actionType: row.actionType
      }))
    : EMPTY_IMPORT.rows;

  return {
    stats: {
      totalProducts: liveProducts.length,
      totalVariants: liveVariants.length,
      draftChanges: await db.draftChange.count({
        where: { storeId: connectedStore.id, status: { in: ["draft", "approved"] } }
      }),
      importErrors: latestImport?.errorRows ?? 0,
      imagesPending: 0,
      lastSyncAt: (connectedStore.lastSyncAt ?? connectedStore.updatedAt).toISOString()
    },
    products: liveProducts,
    variants: liveVariants,
    importSummary: latestImport
      ? {
          id: Number(latestImport.id),
          fileName: latestImport.fileName ?? "latest-import.csv",
          status: latestImport.status,
          totalRows: latestImport.totalRows,
          validRows: latestImport.validRows,
          errorRows: latestImport.errorRows,
          warningRows: Math.max(0, latestImport.totalRows - latestImport.validRows - latestImport.errorRows),
          createdAt: latestImport.createdAt.toISOString(),
          rows: parsedImportRows
        }
      : EMPTY_IMPORT,
    draftChanges: connectedStore.draftChanges.map((change) => {
      const after = (change.afterData ?? null) as Record<string, unknown> | null;
      const before = (change.beforeData ?? null) as Record<string, unknown> | null;
      const summary = summariseDraft(change.entityType, change.changeType, before, after);
      const entityIdNum = change.entityId ? Number(change.entityId) : null;

      let productInfo = null;
      let variantInfo = null;
      if (change.entityType === "product" && entityIdNum !== null) {
        const product = draftProductById.get(entityIdNum);
        if (product) {
          productInfo = {
            id: Number(product.id),
            title: product.title ?? "",
            handle: product.handle ?? "",
            imageSrc: product.productImages[0]?.sourceUrl ?? null
          };
        }
      } else if (change.entityType === "variant" && entityIdNum !== null) {
        const variant = draftVariantById.get(entityIdNum);
        if (variant) {
          productInfo = {
            id: Number(variant.product.id),
            title: variant.product.title ?? "",
            handle: variant.product.handle ?? "",
            imageSrc: variant.product.productImages[0]?.sourceUrl ?? null
          };
          variantInfo = {
            id: Number(variant.id),
            title: variant.title ?? "",
            sku: variant.sku ?? "",
            options: [variant.option1Value, variant.option2Value, variant.option3Value].filter(
              (value): value is string => Boolean(value && value.length > 0)
            )
          };
        }
      }

      return {
        id: Number(change.id),
        entityType: change.entityType,
        changeType: change.changeType,
        status: change.status,
        summary,
        entityId: entityIdNum,
        beforeData: before,
        afterData: after,
        createdAt: change.createdAt.toISOString(),
        product: productInfo,
        variant: variantInfo
      };
    }),
    syncLogs: connectedStore.syncLogs.map((log) => ({
      id: Number(log.id),
      jobType: log.jobType ?? "sync",
      status: log.status,
      message: log.message ?? "",
      createdAt: log.createdAt.toISOString()
    })),
    store: mapStore({
      ...connectedStore,
      currencyCode: (await loadCurrencyCodes([connectedStore.id])).get(String(connectedStore.id)) ?? null
    }),
    stores: allStores
  };
}
