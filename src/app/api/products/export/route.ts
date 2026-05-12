import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { readActiveStoreId } from "@/lib/active-store";
import { decryptValue } from "@/lib/oauth";
import { getPrismaClient } from "@/lib/prisma";
import { ensureSchemaCompatibility } from "@/lib/schema-bootstrap";
import { toEnhancedCsv, type ExportMetafield, type ExportProduct } from "@/lib/export";
import { extractGidsFromValue, isReferenceType, resolveGidsRich } from "@/lib/export-references";

type MetafieldRow = {
  storeId: bigint;
  productId: bigint | null;
  variantId: bigint | null;
  namespace: string;
  metafieldKey: string;
  type: string;
  value: string | null;
};

async function loadProductMetafields(productIds: bigint[]): Promise<Map<string, ExportMetafield[]>> {
  const map = new Map<string, ExportMetafield[]>();
  if (productIds.length === 0) return map;
  const rows = await getPrismaClient().$queryRaw<MetafieldRow[]>(
    Prisma.sql`SELECT productId, namespace, metafieldKey, type, value
               FROM \`ProductMetafield\`
               WHERE productId IN (${Prisma.join(productIds)})`
  );
  for (const row of rows) {
    if (!row.productId) continue;
    const key = String(row.productId);
    const list = map.get(key) ?? [];
    list.push({ namespace: row.namespace, key: row.metafieldKey, type: row.type, value: row.value });
    map.set(key, list);
  }
  return map;
}

async function loadVariantMetafields(variantIds: bigint[]): Promise<Map<string, ExportMetafield[]>> {
  const map = new Map<string, ExportMetafield[]>();
  if (variantIds.length === 0) return map;
  const rows = await getPrismaClient().$queryRaw<MetafieldRow[]>(
    Prisma.sql`SELECT variantId, namespace, metafieldKey, type, value
               FROM \`VariantMetafield\`
               WHERE variantId IN (${Prisma.join(variantIds)})`
  );
  for (const row of rows) {
    if (!row.variantId) continue;
    const key = String(row.variantId);
    const list = map.get(key) ?? [];
    list.push({ namespace: row.namespace, key: row.metafieldKey, type: row.type, value: row.value });
    map.set(key, list);
  }
  return map;
}

async function exportProductsCsv() {
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

  const products = await prisma.product.findMany({
    where: { storeId: store.id },
    orderBy: { updatedAt: "desc" },
    include: {
      variants: { orderBy: { id: "asc" } },
      productImages: { orderBy: { position: "asc" } }
    }
  });

  const productMetafieldsById = await loadProductMetafields(products.map((p) => p.id));
  const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));
  const variantMetafieldsById = await loadVariantMetafields(variantIds);

  const exportProducts: ExportProduct[] = products.map((product) => {
    const rawProduct = product.rawShopifyJson as ExportProduct["rawJson"] | null;
    return {
      handle: product.handle ?? "",
      title: product.title ?? "",
      bodyHtml: product.bodyHtml ?? "",
      vendor: product.vendor ?? "",
      productType: product.productType ?? "",
      tags: (product.tags ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      status: product.status,
      seoTitle: product.seoTitle ?? "",
      seoDescription: product.seoDescription ?? "",
      images: product.productImages.map((image, index) => ({
        src: image.sourceUrl ?? "",
        altText: image.altText ?? "",
        position: image.position ?? index + 1
      })),
      variants: product.variants.map((variant) => {
        const rawVariant = variant.rawShopifyJson as ExportProduct["variants"][number]["rawJson"] | null;
        return {
          sku: variant.sku ?? "",
          barcode: variant.barcode ?? "",
          price: variant.price !== null ? Number(variant.price) : null,
          compareAtPrice: variant.compareAtPrice !== null ? Number(variant.compareAtPrice) : null,
          inventoryQuantity: variant.inventoryQuantity ?? 0,
          option1Value: variant.option1Value ?? "",
          option2Value: variant.option2Value ?? null,
          option3Value: variant.option3Value ?? null,
          image: null,
          rawJson: rawVariant ?? null,
          metafields: variantMetafieldsById.get(String(variant.id)) ?? []
        };
      }),
      metafields: productMetafieldsById.get(String(product.id)) ?? [],
      rawJson: rawProduct ?? null
    };
  });

  // Collect every reference-type metafield GID across the export so we can resolve
  // them all in batched GraphQL calls and emit `[display]` companion columns.
  const referenceGids: string[] = [];
  for (const product of exportProducts) {
    for (const mf of product.metafields) {
      if (isReferenceType(mf.type)) referenceGids.push(...extractGidsFromValue(mf.value));
    }
    for (const variant of product.variants) {
      for (const mf of variant.metafields) {
        if (isReferenceType(mf.type)) referenceGids.push(...extractGidsFromValue(mf.value));
      }
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

  const csv = toEnhancedCsv(exportProducts, {
    shopDomain: store.shopDomain,
    referenceLookup,
    portableLookup
  });

  const fileName = `products-export-${store.shopDomain.replace(/\./g, "-")}-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`
    }
  });
}

export async function POST() {
  return exportProductsCsv();
}

export async function GET() {
  return exportProductsCsv();
}
