import { getPrismaClient } from "@/lib/prisma";
import {
  COLLECTIONS_SYNC_QUERY,
  COLLECTION_METAFIELDS_PAGE_QUERY,
  shopifyGraphQLRequest
} from "@/lib/shopify";

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

type CollectionRuleSet = {
  appliedDisjunctively: boolean;
  rules: Array<{ column: string; relation: string; condition: string }>;
} | null;

type ShopifyCollectionNode = {
  id: string;
  handle: string | null;
  title: string | null;
  descriptionHtml: string | null;
  updatedAt: string;
  sortOrder: string | null;
  templateSuffix: string | null;
  seo: { title: string | null; description: string | null } | null;
  productsCount: { count: number | null } | null;
  ruleSet: CollectionRuleSet;
};

type ShopifyCollectionsResponse = {
  data?: {
    collections: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{ node: ShopifyCollectionNode }>;
    };
  };
  errors?: Array<{ message: string }>;
};

export type CollectionSyncReport = (progress: {
  current: number;
  total: number | null;
  message: string;
}) => void | Promise<void>;

// Pull updatedAt from a rawShopifyJson DB value, which MySQL/Prisma may hand
// back as either a parsed object or a JSON string depending on the driver path.
function rawUpdatedAtFromDb(value: unknown): string | null {
  if (!value) return null;
  let obj: unknown = value;
  if (typeof value === "string") {
    try {
      obj = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const updatedAt = (obj as Record<string, unknown>).updatedAt;
  return typeof updatedAt === "string" ? updatedAt : null;
}

async function fetchAllCollectionMetafields(
  shopifyCollectionId: string,
  shopDomain: string,
  accessToken: string
): Promise<MetafieldNode[]> {
  type PageResp = {
    data?: { collection?: { metafields: MetafieldsConnection } | null };
    errors?: Array<{ message: string }>;
  };

  const nodes: MetafieldNode[] = [];
  let cursor: string | null = null;
  let hasNext = true;
  while (hasNext) {
    const resp: PageResp = await shopifyGraphQLRequest<PageResp>({
      shopDomain,
      accessToken,
      query: COLLECTION_METAFIELDS_PAGE_QUERY,
      variables: { id: shopifyCollectionId, cursor }
    });
    if (resp.errors?.length) break;
    const conn = resp.data?.collection?.metafields;
    if (!conn) break;
    nodes.push(...conn.edges.map((edge) => edge.node));
    hasNext = conn.pageInfo?.hasNextPage ?? false;
    cursor = conn.pageInfo?.endCursor ?? null;
  }
  return nodes;
}

async function replaceCollectionMetafields(
  storeId: bigint,
  collectionId: bigint,
  nodes: MetafieldNode[]
) {
  const db = getPrismaClient();

  await db.$executeRawUnsafe(
    "DELETE FROM `CollectionMetafield` WHERE `collectionId` = ?",
    collectionId
  );

  const deduped = new Map<string, MetafieldNode>();
  for (const node of nodes) {
    if (!node.namespace || !node.key || !node.type) continue;
    deduped.set(`${node.namespace}|${node.key}`, node);
  }

  for (const node of deduped.values()) {
    await db.$executeRawUnsafe(
      `INSERT INTO \`CollectionMetafield\` (storeId, collectionId, shopifyMetafieldId, namespace, metafieldKey, type, value, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE
         shopifyMetafieldId = VALUES(shopifyMetafieldId),
         type = VALUES(type),
         value = VALUES(value),
         updatedAt = NOW(3)`,
      storeId,
      collectionId,
      node.id,
      node.namespace,
      node.key,
      node.type,
      node.value ?? null
    );
  }
}

type ExistingCollectionRow = { id: bigint; rawShopifyJson: unknown };

async function upsertCollection(
  storeId: bigint,
  node: ShopifyCollectionNode
): Promise<{ id: bigint; changed: boolean }> {
  const db = getPrismaClient();

  const rows = await db.$queryRawUnsafe<ExistingCollectionRow[]>(
    "SELECT `id`, `rawShopifyJson` FROM `Collection` WHERE `storeId` = ? AND `shopifyCollectionId` = ? LIMIT 1",
    storeId,
    node.id
  );
  const existing = rows[0];

  const isSmart = Boolean(node.ruleSet && node.ruleSet.rules.length > 0);
  const fields = {
    handle: node.handle ?? "",
    title: node.title ?? "",
    bodyHtml: node.descriptionHtml ?? "",
    sortOrder: node.sortOrder ?? "",
    templateSuffix: node.templateSuffix ?? "",
    isSmart: isSmart ? 1 : 0,
    productsCount: node.productsCount?.count ?? 0,
    seoTitle: node.seo?.title ?? "",
    seoDescription: node.seo?.description ?? "",
    rawShopifyJson: JSON.stringify(node)
  };

  if (existing) {
    const changed = rawUpdatedAtFromDb(existing.rawShopifyJson) !== node.updatedAt;
    if (changed) {
      await db.$executeRawUnsafe(
        `UPDATE \`Collection\` SET
           handle = ?, title = ?, bodyHtml = ?, sortOrder = ?, templateSuffix = ?,
           isSmart = ?, productsCount = ?, seoTitle = ?, seoDescription = ?,
           rawShopifyJson = ?, updatedAt = NOW(3)
         WHERE id = ?`,
        fields.handle,
        fields.title,
        fields.bodyHtml,
        fields.sortOrder,
        fields.templateSuffix,
        fields.isSmart,
        fields.productsCount,
        fields.seoTitle,
        fields.seoDescription,
        fields.rawShopifyJson,
        existing.id
      );
    }
    return { id: existing.id, changed };
  }

  await db.$executeRawUnsafe(
    `INSERT INTO \`Collection\`
       (storeId, shopifyCollectionId, handle, title, bodyHtml, sortOrder, templateSuffix,
        isSmart, productsCount, seoTitle, seoDescription, rawShopifyJson, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
    storeId,
    node.id,
    fields.handle,
    fields.title,
    fields.bodyHtml,
    fields.sortOrder,
    fields.templateSuffix,
    fields.isSmart,
    fields.productsCount,
    fields.seoTitle,
    fields.seoDescription,
    fields.rawShopifyJson
  );

  const inserted = await db.$queryRawUnsafe<{ id: bigint }[]>(
    "SELECT `id` FROM `Collection` WHERE `storeId` = ? AND `shopifyCollectionId` = ? LIMIT 1",
    storeId,
    node.id
  );
  const id = inserted[0]?.id;
  if (!id) throw new Error(`Failed to upsert collection ${node.id}`);
  return { id, changed: true };
}

// Sync all collections (custom + smart) and their metafields into the local DB.
// Mirrors the product sync: upsert by (storeId, shopifyCollectionId), only
// re-fetch metafields for collections whose updatedAt changed, then prune
// collections that no longer exist in Shopify.
export async function syncStoreCollections(params: {
  storeId: bigint;
  shopDomain: string;
  accessToken: string;
  report?: CollectionSyncReport;
}): Promise<{ syncedCollections: number }> {
  const { storeId, shopDomain, accessToken, report } = params;
  const db = getPrismaClient();

  const emit = async (current: number, total: number | null, message: string) => {
    try {
      await report?.({ current, total, message });
    } catch {
      // never let progress reporting break the sync
    }
  };

  await emit(0, null, "Fetching collections from Shopify…");

  const pendingMetafieldFetches: Array<{ shopifyCollectionId: string; localId: bigint }> = [];
  const seenShopifyCollectionIds = new Set<string>();
  let cursor: string | null = null;
  let hasNextPage = true;
  let syncedCollections = 0;

  while (hasNextPage) {
    const response: ShopifyCollectionsResponse =
      await shopifyGraphQLRequest<ShopifyCollectionsResponse>({
        shopDomain,
        accessToken,
        query: COLLECTIONS_SYNC_QUERY,
        variables: { cursor }
      });

    if (response.errors?.length) {
      throw new Error(response.errors.map((error) => error.message).join("; "));
    }

    const connection = response.data?.collections;
    if (!connection) break;

    for (const edge of connection.edges) {
      const node = edge.node;
      seenShopifyCollectionIds.add(node.id);
      const { id, changed } = await upsertCollection(storeId, node);
      if (changed) {
        pendingMetafieldFetches.push({ shopifyCollectionId: node.id, localId: id });
      }
      syncedCollections += 1;
      await emit(syncedCollections, null, `Fetched ${syncedCollections} collections…`);
    }

    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;
  }

  // Metafields for changed collections only.
  const totalMfs = pendingMetafieldFetches.length;
  let mfDone = 0;
  for (const task of pendingMetafieldFetches) {
    const nodes = await fetchAllCollectionMetafields(task.shopifyCollectionId, shopDomain, accessToken);
    await replaceCollectionMetafields(storeId, task.localId, nodes);
    mfDone += 1;
    if (mfDone % 5 === 0 || mfDone === totalMfs) {
      await emit(mfDone, totalMfs, `Collection metafields ${mfDone}/${totalMfs}`);
    }
  }

  // Prune collections that no longer exist in Shopify.
  const existingRows = await db.$queryRawUnsafe<{ id: bigint; shopifyCollectionId: string }[]>(
    "SELECT `id`, `shopifyCollectionId` FROM `Collection` WHERE `storeId` = ?",
    storeId
  );
  const orphanIds = existingRows
    .filter((row) => !seenShopifyCollectionIds.has(row.shopifyCollectionId))
    .map((row) => row.id);
  for (const orphanId of orphanIds) {
    await db.$executeRawUnsafe("DELETE FROM `CollectionMetafield` WHERE `collectionId` = ?", orphanId);
    await db.$executeRawUnsafe("DELETE FROM `Collection` WHERE `id` = ?", orphanId);
  }

  await emit(syncedCollections, syncedCollections, `Synced ${syncedCollections} collections.`);
  return { syncedCollections };
}
