import { decryptValue } from "@/lib/oauth";
import { getPrismaClient } from "@/lib/prisma";
import { shopifyGraphQLRequest } from "@/lib/shopify";

const PRODUCT_UPDATE_MUTATION = `
  mutation ProductUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id title status }
      userErrors { field message }
    }
  }
`;

const PRODUCT_VARIANTS_BULK_UPDATE = `
  mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      product { id }
      productVariants { id sku price barcode }
      userErrors { field message }
    }
  }
`;

const INVENTORY_ADJUST_MUTATION = `
  mutation InventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      inventoryAdjustmentGroup { reason }
      userErrors { field message }
    }
  }
`;

type PushResult = {
  ok: boolean;
  message: string;
};

type DraftRow = {
  id: bigint;
  storeId: bigint;
  entityType: "product" | "variant" | "image" | "inventory" | "metafield";
  entityId: bigint | null;
  shopifyEntityId: string | null;
  changeType: "create" | "update" | "delete";
  beforeData: unknown;
  afterData: unknown;
};

function shopStatusToShopify(status: string | undefined): "ACTIVE" | "DRAFT" | "ARCHIVED" | null {
  if (status === "active") return "ACTIVE";
  if (status === "draft") return "DRAFT";
  if (status === "archived") return "ARCHIVED";
  return null;
}

async function pushProductUpdate(draft: DraftRow): Promise<PushResult> {
  const prisma = getPrismaClient();
  if (!draft.entityId) return { ok: false, message: "Draft has no entityId." };

  const product = await prisma.product.findUnique({ where: { id: draft.entityId } });
  if (!product) return { ok: false, message: "Local product not found. Sync the store first." };
  if (!product.shopifyProductId) {
    return { ok: false, message: "Product has no Shopify ID. Sync the store first." };
  }

  const store = await prisma.store.findUnique({ where: { id: draft.storeId } });
  if (!store?.accessTokenEncrypted) {
    return { ok: false, message: "Store is not connected or token is missing." };
  }

  const after = (draft.afterData ?? {}) as Record<string, unknown>;
  const input: Record<string, unknown> = { id: product.shopifyProductId };

  if (typeof after.title === "string") input.title = after.title;
  if (typeof after.vendor === "string") input.vendor = after.vendor;
  if (typeof after.productType === "string") input.productType = after.productType;
  const shopifyStatus = shopStatusToShopify(after.status as string | undefined);
  if (shopifyStatus) input.status = shopifyStatus;
  if (Array.isArray(after.tags)) input.tags = (after.tags as string[]).filter(Boolean);
  if (typeof after.seoTitle === "string" || typeof after.seoDescription === "string") {
    input.seo = {
      title: typeof after.seoTitle === "string" ? after.seoTitle : undefined,
      description: typeof after.seoDescription === "string" ? after.seoDescription : undefined
    };
  }

  let accessToken: string;
  try {
    accessToken = decryptValue(store.accessTokenEncrypted);
  } catch {
    return { ok: false, message: "Failed to decrypt access token." };
  }

  type ProductUpdateResponse = {
    data?: {
      productUpdate?: {
        product?: { id: string };
        userErrors?: Array<{ field: string[] | null; message: string }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  let response: ProductUpdateResponse;
  try {
    response = await shopifyGraphQLRequest<ProductUpdateResponse>({
      shopDomain: store.shopDomain,
      accessToken,
      query: PRODUCT_UPDATE_MUTATION,
      variables: { input }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Shopify error";
    return { ok: false, message: `Shopify request failed: ${message}` };
  }

  if (response.errors?.length) {
    return { ok: false, message: response.errors.map((e) => e.message).join("; ") };
  }
  const userErrors = response.data?.productUpdate?.userErrors;
  if (userErrors && userErrors.length > 0) {
    return { ok: false, message: userErrors.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`).join("; ") };
  }

  await prisma.product.update({
    where: { id: draft.entityId },
    data: {
      title: typeof after.title === "string" ? after.title : product.title,
      vendor: typeof after.vendor === "string" ? after.vendor : product.vendor,
      productType: typeof after.productType === "string" ? after.productType : product.productType,
      status: (after.status as "active" | "draft" | "archived" | undefined) ?? product.status,
      tags: Array.isArray(after.tags) ? (after.tags as string[]).join(",") : product.tags,
      seoTitle: typeof after.seoTitle === "string" ? after.seoTitle : product.seoTitle,
      seoDescription:
        typeof after.seoDescription === "string" ? after.seoDescription : product.seoDescription
    }
  });

  return { ok: true, message: `Updated ${product.handle ?? product.shopifyProductId} on Shopify.` };
}

async function pushVariantUpdate(draft: DraftRow): Promise<PushResult> {
  const prisma = getPrismaClient();
  if (!draft.entityId) return { ok: false, message: "Variant draft has no entityId." };

  const variant = await prisma.variant.findUnique({ where: { id: draft.entityId } });
  if (!variant) return { ok: false, message: "Local variant not found. Sync the store first." };
  if (!variant.shopifyVariantId) {
    return { ok: false, message: "Variant has no Shopify ID. Sync the store first." };
  }

  const product = await prisma.product.findUnique({ where: { id: variant.productId } });
  if (!product?.shopifyProductId) {
    return { ok: false, message: "Parent product not synced to Shopify." };
  }

  const store = await prisma.store.findUnique({ where: { id: draft.storeId } });
  if (!store?.accessTokenEncrypted) {
    return { ok: false, message: "Store is not connected or token is missing." };
  }

  let accessToken: string;
  try {
    accessToken = decryptValue(store.accessTokenEncrypted);
  } catch {
    return { ok: false, message: "Failed to decrypt access token." };
  }

  const after = (draft.afterData ?? {}) as Record<string, unknown>;
  const before = (draft.beforeData ?? {}) as Record<string, unknown>;

  const variantInput: Record<string, unknown> = { id: variant.shopifyVariantId };
  if (typeof after.sku === "string") variantInput.sku = after.sku;
  if (typeof after.barcode === "string") variantInput.barcode = after.barcode;
  if ("price" in after && (typeof after.price === "number" || typeof after.price === "string")) {
    variantInput.price = String(after.price);
  }
  if (
    "compareAtPrice" in after &&
    (typeof after.compareAtPrice === "number" || typeof after.compareAtPrice === "string")
  ) {
    variantInput.compareAtPrice = after.compareAtPrice === null ? null : String(after.compareAtPrice);
  }

  type VariantsBulkResponse = {
    data?: {
      productVariantsBulkUpdate?: {
        userErrors?: Array<{ field: string[] | null; message: string }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  const needsBulkUpdate = Object.keys(variantInput).length > 1;

  if (needsBulkUpdate) {
    let response: VariantsBulkResponse;
    try {
      response = await shopifyGraphQLRequest<VariantsBulkResponse>({
        shopDomain: store.shopDomain,
        accessToken,
        query: PRODUCT_VARIANTS_BULK_UPDATE,
        variables: { productId: product.shopifyProductId, variants: [variantInput] }
      });
    } catch (error) {
      return {
        ok: false,
        message: `Shopify variant update failed: ${error instanceof Error ? error.message : "unknown"}`
      };
    }
    if (response.errors?.length) {
      return { ok: false, message: response.errors.map((e) => e.message).join("; ") };
    }
    const userErrors = response.data?.productVariantsBulkUpdate?.userErrors;
    if (userErrors && userErrors.length > 0) {
      return {
        ok: false,
        message: userErrors.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`).join("; ")
      };
    }
  }

  if ("inventoryQuantity" in after) {
    const previous =
      typeof before.inventoryQuantity === "number"
        ? before.inventoryQuantity
        : variant.inventoryQuantity ?? 0;
    const next =
      typeof after.inventoryQuantity === "number"
        ? after.inventoryQuantity
        : Number(after.inventoryQuantity) || 0;
    const delta = next - previous;

    if (delta !== 0) {
      if (!variant.inventoryItemId) {
        return {
          ok: false,
          message:
            "Inventory change requires an inventoryItemId on the variant. Re-sync the store so it's populated."
        };
      }

      const locations = await fetch(
        `https://${store.shopDomain}/admin/api/2025-10/locations.json`,
        { headers: { "X-Shopify-Access-Token": accessToken }, cache: "no-store" }
      ).then((r) => r.json() as Promise<{ locations?: Array<{ id: number; name: string }> }>);
      const locationId = locations.locations?.[0]?.id;
      if (!locationId) {
        return { ok: false, message: "Could not find a Shopify location to adjust inventory at." };
      }

      type InventoryResponse = {
        data?: { inventoryAdjustQuantities?: { userErrors?: Array<{ message: string }> } };
        errors?: Array<{ message: string }>;
      };
      const inventoryItemGid = variant.inventoryItemId.startsWith("gid://")
        ? variant.inventoryItemId
        : `gid://shopify/InventoryItem/${variant.inventoryItemId}`;
      const invInput = {
        reason: "correction",
        name: "available",
        changes: [
          {
            delta,
            inventoryItemId: inventoryItemGid,
            locationId: `gid://shopify/Location/${locationId}`
          }
        ]
      };
      let invResponse: InventoryResponse;
      try {
        invResponse = await shopifyGraphQLRequest<InventoryResponse>({
          shopDomain: store.shopDomain,
          accessToken,
          query: INVENTORY_ADJUST_MUTATION,
          variables: { input: invInput }
        });
      } catch (error) {
        return {
          ok: false,
          message: `Inventory adjust failed: ${error instanceof Error ? error.message : "unknown"}`
        };
      }
      if (invResponse.errors?.length) {
        return { ok: false, message: invResponse.errors.map((e) => e.message).join("; ") };
      }
      const invUserErrors = invResponse.data?.inventoryAdjustQuantities?.userErrors;
      if (invUserErrors && invUserErrors.length > 0) {
        return { ok: false, message: invUserErrors.map((e) => e.message).join("; ") };
      }
    }
  }

  await prisma.variant.update({
    where: { id: draft.entityId },
    data: {
      sku: typeof after.sku === "string" ? after.sku : variant.sku,
      barcode: typeof after.barcode === "string" ? after.barcode : variant.barcode,
      price:
        "price" in after && after.price !== null && after.price !== undefined
          ? Number(after.price)
          : variant.price,
      compareAtPrice:
        "compareAtPrice" in after && after.compareAtPrice !== null && after.compareAtPrice !== undefined
          ? Number(after.compareAtPrice)
          : variant.compareAtPrice,
      inventoryQuantity:
        "inventoryQuantity" in after && typeof after.inventoryQuantity === "number"
          ? after.inventoryQuantity
          : variant.inventoryQuantity
    }
  });

  return { ok: true, message: `Updated variant ${variant.sku ?? variant.shopifyVariantId} on Shopify.` };
}

export async function pushDraftToShopify(draftId: number): Promise<PushResult> {
  const prisma = getPrismaClient();
  const draft = (await prisma.draftChange.findUnique({ where: { id: BigInt(draftId) } })) as DraftRow | null;
  if (!draft) return { ok: false, message: "Draft not found." };

  if (draft.entityType === "product" && draft.changeType === "update") {
    return pushProductUpdate(draft);
  }
  if (draft.entityType === "variant" && draft.changeType === "update") {
    return pushVariantUpdate(draft);
  }

  return {
    ok: false,
    message: `Pushing ${draft.entityType}/${draft.changeType} to Shopify is not implemented yet.`
  };
}
