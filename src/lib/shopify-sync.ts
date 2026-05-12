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

type ShopifyProductsResponse = {
  data?: {
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{
        node: {
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
      }>;
    };
  };
  errors?: Array<{ message: string }>;
};

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
    const resp: PageResp = await shopifyGraphQLRequest<PageResp>({
      shopDomain,
      accessToken,
      query,
      variables: { id: shopifyOwnerId, cursor }
    });
    if (resp.errors?.length) break;
    const conn: MetafieldsConnection | undefined =
      scope === "product"
        ? resp.data?.product?.metafields
        : resp.data?.productVariant?.metafields;
    if (!conn) break;
    nodes.push(...conn.edges.map((edge: { node: MetafieldNode }) => edge.node));
    hasNext = conn.pageInfo?.hasNextPage ?? false;
    cursor = conn.pageInfo?.endCursor ?? null;
  }
  return nodes;
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

  // Dedupe by (namespace, key) — Shopify can hand back the same standard
  // taxonomy metafield twice during pagination overlaps.
  const deduped = new Map<string, MetafieldNode>();
  for (const node of nodes) {
    if (!node.namespace || !node.key || !node.type) continue;
    deduped.set(`${node.namespace}|${node.key}`, node);
  }

  for (const node of deduped.values()) {
    // ON DUPLICATE KEY UPDATE makes this idempotent even if a duplicate slips
    // past the in-memory dedupe (e.g. two GIDs for the same namespace.key).
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

export async function syncStoreCatalog(storeId: bigint | number) {
  const db = getPrismaClient();
  const store = await db.store.findUnique({
    where: { id: BigInt(storeId) }
  });

  if (!store) {
    throw new Error("Store not found");
  }

  const accessToken = decryptValue(store.accessTokenEncrypted);

  const shopInfo = await fetchShopInfo(store.shopDomain, accessToken);
  if (shopInfo?.currencyCode && shopInfo.currencyCode !== (store as { currencyCode?: string | null }).currencyCode) {
    await db.$executeRaw(
      Prisma.sql`UPDATE \`Store\` SET \`currencyCode\` = ${shopInfo.currencyCode} WHERE \`id\` = ${store.id}`
    );
  }

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

    const connection: NonNullable<ShopifyProductsResponse["data"]>["products"] | undefined = response.data?.products;
    if (!connection) {
      break;
    }

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

      let productRecord;
      if (existingProduct) {
        productRecord = await db.product.update({
          where: { id: existingProduct.id },
          data: productPayload
        });
      } else {
        try {
          productRecord = await db.product.create({
            data: {
              storeId: store.id,
              shopifyProductId: productNode.id,
              ...productPayload
            }
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            const resolvedProduct = await db.product.findUnique({
              where: {
                storeId_shopifyProductId: {
                  storeId: store.id,
                  shopifyProductId: productNode.id
                }
              }
            });

            if (!resolvedProduct) {
              throw error;
            }

            productRecord = await db.product.update({
              where: { id: resolvedProduct.id },
              data: productPayload
            });
          } else {
            throw error;
          }
        }
      }

      const productMfNodes = await fetchAllMetafields(
        "product",
        productNode.id,
        store.shopDomain,
        accessToken
      );
      await replaceMetafields("product", store.id, productRecord.id, productMfNodes);

      await db.variant.deleteMany({
        where: {
          storeId: store.id,
          productId: productRecord.id
        }
      });

      for (const variantEdge of productNode.variants.edges) {
        const variantNode = variantEdge.node;
        const createdVariant = await db.variant.create({
          data: {
            storeId: store.id,
            productId: productRecord.id,
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
          }
        });
        const variantMfNodes = await fetchAllMetafields(
          "variant",
          variantNode.id,
          store.shopDomain,
          accessToken
        );
        await replaceMetafields("variant", store.id, createdVariant.id, variantMfNodes);
        syncedVariants += 1;
      }

      await db.productImage.deleteMany({
        where: {
          storeId: store.id,
          productId: productRecord.id
        }
      });

      const mediaRows = productNode.media.edges
        .map((mediaEdge: { node: { id: string; alt: string | null; image?: { url: string | null; altText: string | null } | null; preview?: { image?: { url: string | null; altText: string | null } | null } | null } }, index: number) => {
          const url = extractImageUrl(mediaEdge.node);
          if (!url) {
            return null;
          }
          return {
            storeId: store.id,
            productId: productRecord.id,
            shopifyMediaId: mediaEdge.node.id,
            sourceUrl: url,
            altText: mediaEdge.node.alt ?? mediaEdge.node.image?.altText ?? mediaEdge.node.preview?.image?.altText ?? "",
            position: index + 1,
            status: "linked" as const
          };
        })
        .filter((value: MediaRow | null): value is MediaRow => Boolean(value));

      if (mediaRows.length > 0) {
        await db.productImage.createMany({ data: mediaRows });
      }

      syncedProducts += 1;
    }

    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;
  }

  await db.store.update({
    where: { id: store.id },
    data: { lastSyncAt: new Date() }
  });

  await db.syncLog.create({
    data: {
      storeId: store.id,
      jobType: "shopify.initialSync",
      status: "success",
      message: `Synced ${syncedProducts} products and ${syncedVariants} variants.`,
      startedAt: new Date(),
      completedAt: new Date()
    }
  });

  return { syncedProducts, syncedVariants };
}
