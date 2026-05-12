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

export async function pushDraftToShopify(draftId: number): Promise<PushResult> {
  const prisma = getPrismaClient();
  const draft = (await prisma.draftChange.findUnique({ where: { id: BigInt(draftId) } })) as DraftRow | null;
  if (!draft) return { ok: false, message: "Draft not found." };

  if (draft.entityType === "product" && draft.changeType === "update") {
    return pushProductUpdate(draft);
  }

  return {
    ok: false,
    message: `Pushing ${draft.entityType}/${draft.changeType} to Shopify is not implemented yet.`
  };
}
