import { Prisma } from "@prisma/client";

import { getPrismaClient } from "@/lib/prisma";
import { decryptValue } from "@/lib/oauth";
import {
  PRODUCTS_SYNC_QUERY,
  PRODUCT_METAFIELDS_PAGE_QUERY,
  VARIANT_METAFIELDS_PAGE_QUERY,
  fetchShopInfo,
  shopifyGraphQLRequest
} from "@/lib/shopify";
import { syncStoreCollections } from "@/lib/shopify-collections-sync";

type MetafieldNode = {
  id: string;
  namespace: string | null;
  key: string | null;
  value: string | null;
  type: string | null;
};

type MetafieldsConnection = {
  pageInfo?: { hasNextPage: boolean; endCursor: string | null };
  edges: Array<{ node: MetafieldNode }>;
};

type ShopifyProductNode = {
  id: string;
  handle: string | null;
  title: string | null;
  descriptionHtml: string | null;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  vendor: string | null;
  productType: string | null;
  tags: string[];
  updatedAt: string;
  seo: { title: string | null; description: string | null } | null;
  media: {
    edges: Array<{
      node: {
        id: string;
        alt: string | null;
        image?: { url: string | null; altText: string | null } | null;
        preview?: { image?: { url: string | null; altText: string | null } | null } | null;
      };
    }>;
  };
  variants: {
    edges: Array<{
      node: {
        id: string;
        title: string | null;
        sku: string | null;
        barcode: string | null;
        price: string | null;
        compareAtPrice: string | null;
        inventoryQuantity: number | null;
        updatedAt: string;
        inventoryItem?: { id: string | null } | null;
      };
    }>;
  };
};

type ShopifyProductsResponse = {
  data?: {
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{ node: ShopifyProductNode }>;
    };
  };
  errors?: Array<{ message: string }>;
};

export type SyncProgress = {
  phase: "fetching" | "metafields" | "collections" | "cleanup" | "done";
  current: number;
  total: number | null;
  message?: string;
};

export type SyncOptions = {
  onProgress?: (p: SyncProgress) => void | Promise<void>;
};

const METAFIELD_FETCH_ATTEMPTS = 3;

// Retries a transient failure (a dropped connection, a throttle) before giving
// up. The caller treats a final failure as "not fetched" rather than "empty",
// which matters because replaceMetafields deletes what it doesn't replace.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= METAFIELD_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < METAFIELD_FETCH_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Shopify request failed");
}

// Throws when the metafields can't be read. It must never return a short list
// on failure: the caller deletes the owner's stored metafields before inserting
// what it got back, so a swallowed error would wipe them.
async function fetchAllMetafields(
  scope: "product" | "variant",
  shopifyOwnerId: string,
  shopDomain: string,
  accessToken: string
): Promise<MetafieldNode[]> {
  const query = scope === "product" ? PRODUCT_METAFIELDS_PAGE_QUERY : VARIANT_METAFIELDS_PAGE_QUERY;
  type PageResp = {
    data?: {
      product?: { metafields: MetafieldsConnection } | null;
      productVariant?: { metafields: MetafieldsConnection } | null;
    };
    errors?: Array<{ message: string }>;
  };

  const nodes: MetafieldNode[] = [];
  let cursor: string | null = null;
  let hasNext = true;
  while (hasNext) {
    const conn = await withRetry(async () => {
      const resp: PageResp = await shopifyGraphQLRequest<PageResp>({
        shopDomain,
        accessToken,
        query,
        variables: { id: shopifyOwnerId, cursor }
      });
      if (resp.errors?.length) {
        throw new Error(resp.errors.map((error) => error.message).join("; "));
      }
      return scope === "product"
        ? resp.data?.product?.metafields
        : resp.data?.productVariant?.metafields;
    });
    // No connection means the owner is gone from Shopify (deleted since phase
    // 1). There is nothing to store; the cleanup phase drops the local row.
    if (!conn) break;
    nodes.push(...conn.edges.map((edge: { node: MetafieldNode }) => edge.node));
    hasNext = conn.pageInfo?.hasNextPage ?? false;
    cursor = conn.pageInfo?.endCursor ?? null;
  }
  return nodes;
}

// `metafieldsSyncedAt` records that the metafield phase finished for this
// owner. The sync can't infer that from the owner's Shopify `updatedAt`: phase
// 1 stores the new updatedAt, so if the run dies before phase 2 reaches this
// owner, every later sync sees an unchanged updatedAt, skips the fetch, and
// reports success while the owner has no metafields at all.
async function loadMetafieldStamps(storeId: bigint, scope: "product" | "variant") {
  const db = getPrismaClient();
  const table = scope === "product" ? "Product" : "Variant";
  const rows = await db.$queryRawUnsafe<{ id: bigint }[]>(
    `SELECT \`id\` FROM \`${table}\` WHERE \`storeId\` = ? AND \`metafieldsSyncedAt\` IS NOT NULL`,
    storeId
  );
  return new Set(rows.map((row) => String(row.id)));
}

// Written raw so the sync keeps working against a Prisma client that was
// generated before this column existed.
async function setMetafieldStamp(scope: "product" | "variant", ownerId: bigint, synced: boolean) {
  const db = getPrismaClient();
  const table = scope === "product" ? "Product" : "Variant";
  await db.$executeRawUnsafe(
    `UPDATE \`${table}\` SET \`metafieldsSyncedAt\` = ${synced ? "NOW(3)" : "NULL"} WHERE \`id\` = ?`,
    ownerId
  );
}

async function replaceMetafields(
  scope: "product" | "variant",
  storeId: bigint,
  ownerId: bigint,
  nodes: MetafieldNode[]
) {
  const db = getPrismaClient();
  const table = scope === "product" ? "ProductMetafield" : "VariantMetafield";
  const ownerColumn = scope === "product" ? "productId" : "variantId";

  await db.$executeRawUnsafe(
    `DELETE FROM \`${table}\` WHERE \`${ownerColumn}\` = ?`,
    ownerId
  );

  const deduped = new Map<string, MetafieldNode>();
  for (const node of nodes) {
    if (!node.namespace || !node.key || !node.type) continue;
    deduped.set(`${node.namespace}|${node.key}`, node);
  }

  for (const node of deduped.values()) {
    await db.$executeRawUnsafe(
      `INSERT INTO \`${table}\` (storeId, ${ownerColumn}, shopifyMetafieldId, namespace, metafieldKey, type, value, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE
         shopifyMetafieldId = VALUES(shopifyMetafieldId),
         type = VALUES(type),
         value = VALUES(value),
         updatedAt = NOW(3)`,
      storeId,
      ownerId,
      node.id,
      node.namespace,
      node.key,
      node.type,
      node.value ?? null
    );
  }
}

function toProductStatus(value: "ACTIVE" | "DRAFT" | "ARCHIVED") {
  if (value === "ACTIVE") return "active" as const;
  if (value === "ARCHIVED") return "archived" as const;
  return "draft" as const;
}

function extractImageUrl(node: {
  image?: { url: string | null } | null;
  preview?: { image?: { url: string | null } | null } | null;
}) {
  return node.image?.url ?? node.preview?.image?.url ?? null;
}

type MediaRow = {
  storeId: bigint;
  productId: bigint;
  shopifyMediaId: string;
  sourceUrl: string;
  altText: string;
  position: number;
  status: "linked";
};

function rawUpdatedAt(raw: Prisma.JsonValue | null | undefined): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>).updatedAt;
  return typeof value === "string" ? value : null;
}

// Whether a stored product payload already captured the `collections` field.
// Lets us backfill it once for products synced before collection membership
// was added, without re-fetching everything on every sync.
function rawHasCollections(raw: Prisma.JsonValue | null | undefined): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return "collections" in (raw as Record<string, unknown>);
}

export async function syncStoreCatalog(
  storeId: bigint | number,
  options: SyncOptions = {}
) {
  const db = getPrismaClient();
  const report = async (progress: SyncProgress) => {
    try {
      await options.onProgress?.(progress);
    } catch {
      // never let progress reporting break the sync
    }
  };

  const store = await db.store.findUnique({
    where: { id: BigInt(storeId) }
  });
  if (!store) throw new Error("Store not found");

  const accessToken = decryptValue(store.accessTokenEncrypted);

  const shopInfo = await fetchShopInfo(store.shopDomain, accessToken);
  if (shopInfo?.currencyCode && shopInfo.currencyCode !== (store as { currencyCode?: string | null }).currencyCode) {
    await db.$executeRaw(
      Prisma.sql`UPDATE \`Store\` SET \`currencyCode\` = ${shopInfo.currencyCode} WHERE \`id\` = ${store.id}`
    );
  }

  // ---- Phase 1: fetch all products+variants, upsert without metafields ----
  await report({ phase: "fetching", current: 0, total: null, message: "Fetching products from Shopify…" });

  type PendingMetafieldFetch = {
    ownerType: "product" | "variant";
    shopifyOwnerId: string;
    localOwnerId: bigint;
  };

  const pendingMetafieldFetches: PendingMetafieldFetch[] = [];
  // Owners whose metafields a previous run actually stored. Anything missing
  // here is queued even when Shopify says the owner hasn't changed.
  const productStamps = await loadMetafieldStamps(store.id, "product");
  const variantStamps = await loadMetafieldStamps(store.id, "variant");
  const seenShopifyVariantIdsByProductId = new Map<string, Set<string>>();
  let cursor: string | null = null;
  let hasNextPage = true;
  let syncedProducts = 0;
  let syncedVariants = 0;

  while (hasNextPage) {
    const response: ShopifyProductsResponse = await shopifyGraphQLRequest<ShopifyProductsResponse>({
      shopDomain: store.shopDomain,
      accessToken,
      query: PRODUCTS_SYNC_QUERY,
      variables: { cursor }
    });

    if (response.errors?.length) {
      throw new Error(response.errors.map((error: { message: string }) => error.message).join("; "));
    }

    const connection = response.data?.products;
    if (!connection) break;

    for (const edge of connection.edges) {
      const productNode = edge.node;
      const productPayload = {
        handle: productNode.handle ?? "",
        title: productNode.title ?? "",
        bodyHtml: productNode.descriptionHtml ?? "",
        vendor: productNode.vendor ?? "",
        productType: productNode.productType ?? "",
        tags: productNode.tags.join(","),
        status: toProductStatus(productNode.status),
        seoTitle: productNode.seo?.title ?? "",
        seoDescription: productNode.seo?.description ?? "",
        rawShopifyJson: productNode as unknown as Prisma.InputJsonValue
      };

      const existingProduct = await db.product.findUnique({
        where: {
          storeId_shopifyProductId: {
            storeId: store.id,
            shopifyProductId: productNode.id
          }
        }
      });

      const productUnchanged =
        existingProduct && rawUpdatedAt(existingProduct.rawShopifyJson) === productNode.updatedAt;
      // One-time backfill: if the stored payload predates the `collections`
      // field, refresh it even when updatedAt hasn't changed.
      const needsCollectionsBackfill =
        existingProduct && !rawHasCollections(existingProduct.rawShopifyJson);

      let productRecord = existingProduct;
      if (existingProduct) {
        if (!productUnchanged || needsCollectionsBackfill) {
          productRecord = await db.product.update({
            where: { id: existingProduct.id },
            data: productPayload
          });
        }
      } else {
        try {
          productRecord = await db.product.create({
            data: { storeId: store.id, shopifyProductId: productNode.id, ...productPayload }
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            const resolvedProduct = await db.product.findUnique({
              where: {
                storeId_shopifyProductId: {
                  storeId: store.id,
                  shopifyProductId: productNode.id
                }
              }
            });
            if (!resolvedProduct) throw error;
            productRecord = await db.product.update({
              where: { id: resolvedProduct.id },
              data: productPayload
            });
          } else {
            throw error;
          }
        }
      }
      if (!productRecord) continue;
      const productLocalId = productRecord.id;

      if (!productUnchanged || !productStamps.has(String(productLocalId))) {
        pendingMetafieldFetches.push({
          ownerType: "product",
          shopifyOwnerId: productNode.id,
          localOwnerId: productLocalId
        });
      }

      // ---- Variants: upsert by (storeId, shopifyVariantId) — no flicker ----
      const seenVariantIds = new Set<string>();
      seenShopifyVariantIdsByProductId.set(productNode.id, seenVariantIds);

      for (const variantEdge of productNode.variants.edges) {
        const variantNode = variantEdge.node;
        seenVariantIds.add(variantNode.id);

        const existingVariant = await db.variant.findFirst({
          where: { storeId: store.id, shopifyVariantId: variantNode.id }
        });

        const variantUnchanged =
          existingVariant && rawUpdatedAt(existingVariant.rawShopifyJson) === variantNode.updatedAt;

        const variantData = {
          storeId: store.id,
          productId: productLocalId,
          shopifyVariantId: variantNode.id,
          sku: variantNode.sku ?? "",
          barcode: variantNode.barcode ?? "",
          title: variantNode.title ?? "",
          option1Name: "Option 1",
          option1Value: variantNode.title ?? "",
          price: variantNode.price ? Number(variantNode.price) : null,
          compareAtPrice: variantNode.compareAtPrice ? Number(variantNode.compareAtPrice) : null,
          inventoryQuantity: variantNode.inventoryQuantity ?? 0,
          inventoryItemId: variantNode.inventoryItem?.id ?? null,
          rawShopifyJson: variantNode as unknown as Prisma.InputJsonValue
        };

        let variantRecord = existingVariant;
        if (existingVariant) {
          if (!variantUnchanged) {
            variantRecord = await db.variant.update({
              where: { id: existingVariant.id },
              data: {
                productId: productLocalId,
                sku: variantData.sku,
                barcode: variantData.barcode,
                title: variantData.title,
                price: variantData.price,
                compareAtPrice: variantData.compareAtPrice,
                inventoryQuantity: variantData.inventoryQuantity,
                inventoryItemId: variantData.inventoryItemId,
                rawShopifyJson: variantData.rawShopifyJson
              }
            });
          }
        } else {
          variantRecord = await db.variant.create({ data: variantData });
        }
        if (!variantRecord) continue;

        if (!variantUnchanged || !variantStamps.has(String(variantRecord.id))) {
          pendingMetafieldFetches.push({
            ownerType: "variant",
            shopifyOwnerId: variantNode.id,
            localOwnerId: variantRecord.id
          });
        }
        syncedVariants += 1;
      }

      // Replace product media (cheap, no Shopify call).
      await db.productImage.deleteMany({
        where: { storeId: store.id, productId: productLocalId }
      });
      const mediaRows = productNode.media.edges
        .map((mediaEdge, index): MediaRow | null => {
          const url = extractImageUrl(mediaEdge.node);
          if (!url) return null;
          return {
            storeId: store.id,
            productId: productLocalId,
            shopifyMediaId: mediaEdge.node.id,
            sourceUrl: url,
            altText:
              mediaEdge.node.alt ??
              mediaEdge.node.image?.altText ??
              mediaEdge.node.preview?.image?.altText ??
              "",
            position: index + 1,
            status: "linked" as const
          };
        })
        .filter((value): value is MediaRow => Boolean(value));
      if (mediaRows.length > 0) {
        await db.productImage.createMany({ data: mediaRows });
      }

      syncedProducts += 1;
      await report({
        phase: "fetching",
        current: syncedProducts,
        total: null,
        message: `Fetched ${syncedProducts} products…`
      });
    }

    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;
  }

  // ---- Phase 2: metafields for changed owners only ----
  const totalMfs = pendingMetafieldFetches.length;
  await report({
    phase: "metafields",
    current: 0,
    total: totalMfs,
    message: totalMfs === 0 ? "No metafield updates needed." : `Fetching metafields for ${totalMfs} item(s)…`
  });

  let mfDone = 0;
  let mfDeferred = 0;
  let firstMfError: string | null = null;
  for (const task of pendingMetafieldFetches) {
    try {
      const nodes = await fetchAllMetafields(
        task.ownerType,
        task.shopifyOwnerId,
        store.shopDomain,
        accessToken
      );
      await replaceMetafields(task.ownerType, store.id, task.localOwnerId, nodes);
      await setMetafieldStamp(task.ownerType, task.localOwnerId, true);
    } catch (error) {
      // One owner's metafields failing must not abort the rest of the queue,
      // and must not be mistaken for "this owner has none". Clearing the stamp
      // leaves it queued for the next sync no matter what updatedAt says.
      mfDeferred += 1;
      if (!firstMfError) firstMfError = error instanceof Error ? error.message : "unknown error";
      try {
        await setMetafieldStamp(task.ownerType, task.localOwnerId, false);
      } catch {
        // best-effort; the owner still has no stamp, so it stays queued
      }
    }
    mfDone += 1;
    if (mfDone % 5 === 0 || mfDone === totalMfs) {
      await report({
        phase: "metafields",
        current: mfDone,
        total: totalMfs,
        message: `Metafields ${mfDone}/${totalMfs}${mfDeferred > 0 ? ` (${mfDeferred} deferred)` : ""}`
      });
    }
  }

  // ---- Phase 3: cleanup orphan variants whose shopifyVariantId no longer exists ----
  await report({ phase: "cleanup", current: 0, total: null, message: "Removing deleted variants…" });
  for (const [shopifyProductId, seenVariantIds] of seenShopifyVariantIdsByProductId) {
    const product = await db.product.findUnique({
      where: { storeId_shopifyProductId: { storeId: store.id, shopifyProductId } }
    });
    if (!product) continue;
    if (seenVariantIds.size === 0) {
      await db.variant.deleteMany({ where: { storeId: store.id, productId: product.id } });
      continue;
    }
    await db.variant.deleteMany({
      where: {
        storeId: store.id,
        productId: product.id,
        shopifyVariantId: { notIn: Array.from(seenVariantIds) }
      }
    });
  }

  // ---- Phase 4: collections (custom + smart) and their metafields ----
  const { syncedCollections } = await syncStoreCollections({
    storeId: store.id,
    shopDomain: store.shopDomain,
    accessToken,
    report: (p) =>
      report({ phase: "collections", current: p.current, total: p.total, message: p.message })
  });

  await db.store.update({
    where: { id: store.id },
    data: { lastSyncAt: new Date() }
  });

  const summary =
    `Synced ${syncedProducts} products, ${syncedVariants} variants, ${syncedCollections} collections.` +
    (mfDeferred > 0
      ? ` ${mfDeferred} item(s) had metafields deferred (${firstMfError}) — the next sync retries them.`
      : "");

  await db.syncLog.create({
    data: {
      storeId: store.id,
      jobType: "shopify.initialSync",
      status: mfDeferred > 0 ? "partial" : "success",
      message: summary,
      startedAt: new Date(),
      completedAt: new Date()
    }
  });

  await report({
    phase: "done",
    current: syncedProducts,
    total: syncedProducts,
    message: summary
  });

  return { syncedProducts, syncedVariants, syncedCollections, deferredMetafields: mfDeferred, summary };
}
