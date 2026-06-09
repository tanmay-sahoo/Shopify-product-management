import { Prisma } from "@prisma/client";

import { readActiveStoreId } from "@/lib/active-store";
import { listConnectedStores } from "@/lib/data-service";
import { getPrismaClient } from "@/lib/prisma";
import { ensureSchemaCompatibility } from "@/lib/schema-bootstrap";
import type { StoreSummary } from "@/lib/types";

export type CollectionMetafieldView = {
  namespace: string;
  key: string;
  type: string;
  value: string | null;
};

export type CollectionView = {
  id: number;
  shopifyCollectionId: string;
  handle: string;
  title: string;
  bodyHtml: string;
  sortOrder: string;
  templateSuffix: string;
  isSmart: boolean;
  productsCount: number;
  seoTitle: string;
  seoDescription: string;
  imageUrl: string;
  imageAlt: string;
  updatedAt: string;
  metafields: CollectionMetafieldView[];
};

export type CollectionsData = {
  collections: CollectionView[];
  store: StoreSummary | null;
  stores: StoreSummary[];
  // Set when the database (or schema bootstrap) couldn't be reached, so the page
  // can show a "can't reach database" message instead of crashing the route.
  dbError?: boolean;
};

type CollectionRow = {
  id: bigint;
  shopifyCollectionId: string;
  handle: string | null;
  title: string | null;
  bodyHtml: string | null;
  sortOrder: string | null;
  templateSuffix: string | null;
  isSmart: number | boolean | null;
  productsCount: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  updatedAt: Date;
};

type MetafieldRow = {
  collectionId: bigint;
  namespace: string;
  metafieldKey: string;
  type: string;
  value: string | null;
};

async function loadCollectionMetafields(
  collectionIds: bigint[]
): Promise<Map<string, CollectionMetafieldView[]>> {
  const map = new Map<string, CollectionMetafieldView[]>();
  if (collectionIds.length === 0) return map;
  const rows = await getPrismaClient().$queryRaw<MetafieldRow[]>(
    Prisma.sql`SELECT collectionId, namespace, metafieldKey, type, value
               FROM \`CollectionMetafield\`
               WHERE collectionId IN (${Prisma.join(collectionIds)})
               ORDER BY namespace ASC, metafieldKey ASC`
  );
  for (const row of rows) {
    const key = String(row.collectionId);
    const list = map.get(key) ?? [];
    list.push({ namespace: row.namespace, key: row.metafieldKey, type: row.type, value: row.value });
    map.set(key, list);
  }
  return map;
}

export async function getCollectionsData(): Promise<CollectionsData> {
  const db = getPrismaClient();

  try {
    await ensureSchemaCompatibility();
  } catch (error) {
    console.error("[collections-service] database unreachable during schema bootstrap", error);
    return { collections: [], store: null, stores: [], dbError: true };
  }

  try {
    const activeId = await readActiveStoreId();
    const stores = await listConnectedStores();

    const baseWhere = { status: { not: "uninstalled" as const } };
    const where = activeId
      ? { id: BigInt(activeId), ...baseWhere }
      : { ...baseWhere, status: "active" as const };
    const storeRow = await db.store.findFirst({ where, orderBy: { updatedAt: "desc" } });

    if (!storeRow) {
      return { collections: [], store: null, stores };
    }

    const store = stores.find((candidate) => candidate.id === Number(storeRow.id)) ?? null;

    const rows = await db.$queryRaw<CollectionRow[]>(
      Prisma.sql`SELECT id, shopifyCollectionId, handle, title, bodyHtml, sortOrder, templateSuffix,
                        isSmart, productsCount, seoTitle, seoDescription, imageUrl, imageAlt, updatedAt
                 FROM \`Collection\`
                 WHERE storeId = ${storeRow.id}
                 ORDER BY title ASC`
    );

    const metafields = await loadCollectionMetafields(rows.map((row) => row.id));

    const collections: CollectionView[] = rows.map((row) => ({
    id: Number(row.id),
    shopifyCollectionId: row.shopifyCollectionId,
    handle: row.handle ?? "",
    title: row.title ?? "",
    bodyHtml: row.bodyHtml ?? "",
    sortOrder: row.sortOrder ?? "",
    templateSuffix: row.templateSuffix ?? "",
    isSmart: Boolean(Number(row.isSmart ?? 0)),
    productsCount: Number(row.productsCount ?? 0),
    seoTitle: row.seoTitle ?? "",
    seoDescription: row.seoDescription ?? "",
    imageUrl: row.imageUrl ?? "",
    imageAlt: row.imageAlt ?? "",
    updatedAt: row.updatedAt.toISOString(),
    metafields: metafields.get(String(row.id)) ?? []
  }));

    return { collections, store, stores };
  } catch (error) {
    console.error("[collections-service] database unreachable while loading collections", error);
    return { collections: [], store: null, stores: [], dbError: true };
  }
}
