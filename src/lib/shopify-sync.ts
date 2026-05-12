import { Prisma } from "@prisma/client";

import { getPrismaClient } from "@/lib/prisma";
import { decryptValue } from "@/lib/oauth";
import { PRODUCTS_SYNC_QUERY, shopifyGraphQLRequest } from "@/lib/shopify";

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
              };
            }>;
          };
        };
      }>;
    };
  };
  errors?: Array<{ message: string }>;
};

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

      await db.variant.deleteMany({
        where: {
          storeId: store.id,
          productId: productRecord.id
        }
      });

      for (const variantEdge of productNode.variants.edges) {
        const variantNode = variantEdge.node;
        await db.variant.create({
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
            rawShopifyJson: variantNode as unknown as Prisma.InputJsonValue
          }
        });
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
