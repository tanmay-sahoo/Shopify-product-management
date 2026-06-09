import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { readActiveStoreId } from "@/lib/active-store";
import { toCollectionsCsv, type ExportCollection } from "@/lib/collections-export";
import { csvResponse } from "@/lib/csv-response";
import { extractGidsFromValue, isReferenceType, resolveGidsRich } from "@/lib/export-references";
import type { ExportMetafield } from "@/lib/export";
import { decryptValue } from "@/lib/oauth";
import { getPrismaClient } from "@/lib/prisma";
import { ensureSchemaCompatibility } from "@/lib/schema-bootstrap";

type CollectionRow = {
  id: bigint;
  shopifyCollectionId: string;
  handle: string | null;
  title: string | null;
  bodyHtml: string | null;
  sortOrder: string | null;
  templateSuffix: string | null;
  isSmart: number | boolean | null;
  seoTitle: string | null;
  seoDescription: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
};

type MetafieldRow = {
  collectionId: bigint;
  namespace: string;
  metafieldKey: string;
  type: string;
  value: string | null;
};

function numericId(gid: string): string {
  const last = gid.split("/").pop() ?? gid;
  return last.split("?")[0];
}

async function loadCollectionMetafields(collectionIds: bigint[]): Promise<Map<string, ExportMetafield[]>> {
  const map = new Map<string, ExportMetafield[]>();
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

async function exportCollectionsCsv() {
  await ensureSchemaCompatibility();
  const prisma = getPrismaClient();

  const activeId = await readActiveStoreId();
  const store = await prisma.store.findFirst({
    where: activeId
      ? { id: BigInt(activeId), status: { not: "uninstalled" } }
      : { status: "active" },
    orderBy: { updatedAt: "desc" }
  });

  if (!store) {
    return NextResponse.json({ error: "No store connected. Connect a Shopify store first." }, { status: 400 });
  }

  const rows = await prisma.$queryRaw<CollectionRow[]>(
    Prisma.sql`SELECT id, shopifyCollectionId, handle, title, bodyHtml, sortOrder, templateSuffix,
                      isSmart, seoTitle, seoDescription, imageUrl, imageAlt
               FROM \`Collection\`
               WHERE storeId = ${store.id}
               ORDER BY title ASC`
  );

  const metafieldsById = await loadCollectionMetafields(rows.map((row) => row.id));

  const exportCollections: ExportCollection[] = rows.map((row) => ({
    id: numericId(row.shopifyCollectionId),
    handle: row.handle ?? "",
    title: row.title ?? "",
    bodyHtml: row.bodyHtml ?? "",
    sortOrder: row.sortOrder ?? "",
    templateSuffix: row.templateSuffix ?? "",
    isSmart: Boolean(Number(row.isSmart ?? 0)),
    seoTitle: row.seoTitle ?? "",
    seoDescription: row.seoDescription ?? "",
    imageSrc: row.imageUrl ?? "",
    imageAlt: row.imageAlt ?? "",
    metafields: metafieldsById.get(String(row.id)) ?? []
  }));

  // Resolve reference-type metafield GIDs so we can emit `[display]`/`[ref]` columns.
  const referenceGids: string[] = [];
  for (const collection of exportCollections) {
    for (const mf of collection.metafields) {
      if (isReferenceType(mf.type)) referenceGids.push(...extractGidsFromValue(mf.value));
    }
  }

  let referenceLookup = new Map<string, string>();
  let portableLookup = new Map<string, string>();
  if (referenceGids.length > 0 && store.accessTokenEncrypted) {
    try {
      const accessToken = decryptValue(store.accessTokenEncrypted);
      const resolved = await resolveGidsRich(store.shopDomain, accessToken, referenceGids);
      referenceLookup = resolved.displays;
      portableLookup = resolved.portables;
    } catch {
      // Best-effort — the raw GID column still survives for re-import.
    }
  }

  const csv = toCollectionsCsv(exportCollections, {
    shopDomain: store.shopDomain,
    referenceLookup,
    portableLookup
  });

  const fileName = `collections-export-${store.shopDomain.replace(/\./g, "-")}-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;

  return csvResponse(csv, fileName);
}

export async function POST() {
  return exportCollectionsCsv();
}

export async function GET() {
  return exportCollectionsCsv();
}
