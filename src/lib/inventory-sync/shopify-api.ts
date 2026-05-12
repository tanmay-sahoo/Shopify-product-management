import { decryptValue } from "@/lib/oauth";
import { getPrismaClient } from "@/lib/prisma";
import { shopifyGraphQLRequest } from "@/lib/shopify";

const LOCATIONS_QUERY = `
  query Locations { locations(first: 10) { edges { node { id name isActive fulfillsOnlineOrders } } } }
`;

const INVENTORY_SET_MUTATION = `
  mutation InventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup { id reason }
      userErrors { field message }
    }
  }
`;

const VARIANT_PRICES_BULK_UPDATE = `
  mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }
`;

const VARIANT_LOOKUP_QUERY = `
  query VariantLookup($id: ID!) {
    productVariant(id: $id) {
      id
      price
      inventoryQuantity
      inventoryItem { id }
      product { id }
    }
  }
`;

const INVENTORY_LEVELS_QUERY = `
  query InventoryLevels($id: ID!) {
    inventoryItem(id: $id) {
      id
      inventoryLevels(first: 10) {
        edges { node { location { id } quantities(names: ["available"]) { name quantity } } }
      }
    }
  }
`;

export type StoreCreds = { id: number; shopDomain: string; accessToken: string };

export async function loadStoreCreds(storeId: number): Promise<StoreCreds | null> {
  const store = await getPrismaClient().store.findUnique({ where: { id: BigInt(storeId) } });
  if (!store?.accessTokenEncrypted) return null;
  try {
    return { id: storeId, shopDomain: store.shopDomain, accessToken: decryptValue(store.accessTokenEncrypted) };
  } catch {
    return null;
  }
}

const locationCache = new Map<number, { primary: string; all: string[]; cachedAt: number }>();

export async function getPrimaryLocation(store: StoreCreds): Promise<string | null> {
  const cached = locationCache.get(store.id);
  if (cached && Date.now() - cached.cachedAt < 5 * 60 * 1000) return cached.primary;

  type Resp = {
    data?: { locations?: { edges?: Array<{ node: { id: string; isActive: boolean; fulfillsOnlineOrders: boolean } }> } };
    errors?: Array<{ message: string }>;
  };
  const resp = await shopifyGraphQLRequest<Resp>({
    shopDomain: store.shopDomain,
    accessToken: store.accessToken,
    query: LOCATIONS_QUERY
  });
  const all = (resp.data?.locations?.edges ?? []).filter((e) => e.node.isActive).map((e) => e.node.id);
  if (all.length === 0) return null;
  const primary =
    resp.data?.locations?.edges?.find((e) => e.node.isActive && e.node.fulfillsOnlineOrders)?.node.id ?? all[0];
  locationCache.set(store.id, { primary, all, cachedAt: Date.now() });
  return primary;
}

export async function setInventoryQuantity(
  store: StoreCreds,
  args: { inventoryItemId: string; locationId: string; quantity: number; referenceDocumentUri?: string; ignoreCompareQuantity?: boolean }
): Promise<{ ok: boolean; message: string }> {
  type Resp = {
    data?: { inventorySetQuantities?: { userErrors?: Array<{ field: string[] | null; message: string }> } };
    errors?: Array<{ message: string }>;
  };
  const input = {
    reason: "correction",
    name: "available",
    ignoreCompareQuantity: args.ignoreCompareQuantity ?? true,
    referenceDocumentUri: args.referenceDocumentUri ?? "app://linked-inventory-sync",
    quantities: [
      { inventoryItemId: args.inventoryItemId, locationId: args.locationId, quantity: args.quantity }
    ]
  };
  let resp: Resp;
  try {
    resp = await shopifyGraphQLRequest<Resp>({
      shopDomain: store.shopDomain,
      accessToken: store.accessToken,
      query: INVENTORY_SET_MUTATION,
      variables: { input }
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Shopify request failed" };
  }
  if (resp.errors?.length) return { ok: false, message: resp.errors.map((e) => e.message).join("; ") };
  const userErrors = resp.data?.inventorySetQuantities?.userErrors ?? [];
  if (userErrors.length) {
    return { ok: false, message: userErrors.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`).join("; ") };
  }
  return { ok: true, message: "ok" };
}

export async function bulkUpdateVariantPrices(
  store: StoreCreds,
  productId: string,
  updates: Array<{ id: string; price: string }>
): Promise<{ ok: boolean; message: string }> {
  type Resp = {
    data?: { productVariantsBulkUpdate?: { userErrors?: Array<{ field: string[] | null; message: string }> } };
    errors?: Array<{ message: string }>;
  };
  let resp: Resp;
  try {
    resp = await shopifyGraphQLRequest<Resp>({
      shopDomain: store.shopDomain,
      accessToken: store.accessToken,
      query: VARIANT_PRICES_BULK_UPDATE,
      variables: { productId, variants: updates }
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Shopify request failed" };
  }
  if (resp.errors?.length) return { ok: false, message: resp.errors.map((e) => e.message).join("; ") };
  const userErrors = resp.data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (userErrors.length) {
    return { ok: false, message: userErrors.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`).join("; ") };
  }
  return { ok: true, message: "ok" };
}

export type VariantInfo = {
  id: string;
  productId: string;
  price: string | null;
  inventoryQuantity: number;
  inventoryItemId: string | null;
};

export async function lookupVariant(store: StoreCreds, variantGid: string): Promise<VariantInfo | null> {
  type Resp = {
    data?: {
      productVariant?: {
        id: string;
        price: string | null;
        inventoryQuantity: number | null;
        inventoryItem: { id: string } | null;
        product: { id: string };
      } | null;
    };
    errors?: Array<{ message: string }>;
  };
  let resp: Resp;
  try {
    resp = await shopifyGraphQLRequest<Resp>({
      shopDomain: store.shopDomain,
      accessToken: store.accessToken,
      query: VARIANT_LOOKUP_QUERY,
      variables: { id: variantGid }
    });
  } catch {
    return null;
  }
  const node = resp.data?.productVariant;
  if (!node) return null;
  return {
    id: node.id,
    productId: node.product.id,
    price: node.price,
    inventoryQuantity: node.inventoryQuantity ?? 0,
    inventoryItemId: node.inventoryItem?.id ?? null
  };
}

export async function getInventoryAvailableAtLocation(
  store: StoreCreds,
  inventoryItemId: string,
  locationId: string
): Promise<number | null> {
  type Resp = {
    data?: {
      inventoryItem?: {
        inventoryLevels?: {
          edges?: Array<{
            node: { location: { id: string }; quantities: Array<{ name: string; quantity: number }> };
          }>;
        };
      } | null;
    };
  };
  let resp: Resp;
  try {
    resp = await shopifyGraphQLRequest<Resp>({
      shopDomain: store.shopDomain,
      accessToken: store.accessToken,
      query: INVENTORY_LEVELS_QUERY,
      variables: { id: inventoryItemId }
    });
  } catch {
    return null;
  }
  const edge = resp.data?.inventoryItem?.inventoryLevels?.edges?.find((e) => e.node.location.id === locationId);
  const qty = edge?.node.quantities.find((q) => q.name === "available")?.quantity;
  return typeof qty === "number" ? qty : null;
}
