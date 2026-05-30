// Pushes parsed CSV products into Shopify. For each product:
//  - upsert by handle (productCreate / productUpdate)
//  - replace variants via productSet (the simplest cross-product mutation)
//  - upload images via productCreateMedia
//  - apply metafields via metafieldsSet
//  - set inventory levels via inventorySetQuantities
//
// Best-effort, per-product. Errors are reported back per-product so partial
// imports still produce useful output.

import { decryptValue } from "@/lib/oauth";
import { getPrismaClient } from "@/lib/prisma";
import { shopifyGraphQLRequest } from "@/lib/shopify";
import { DestinationResolver } from "@/lib/import-references";

import type { ParsedProduct, ParsedVariant } from "@/lib/import-parser";

const REFERENCE_TYPE_RE = /^(list\.)?(metaobject|product|variant|collection|file|page)_reference$/;
function isReferenceType(type: string): boolean {
  return REFERENCE_TYPE_RE.test(type);
}

export type PushOutcome = {
  handle: string;
  ok: boolean;
  message: string;
  productId?: string | null;
  variantsCreated?: number;
  imagesCreated?: number;
  metafieldsSet?: number;
};

const FIND_PRODUCT_BY_HANDLE = `
  query FindByHandle($query: String!) {
    products(first: 1, query: $query) {
      edges { node { id handle title status options { id name position } } }
    }
  }
`;

function toProductGid(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("gid://")) return trimmed;
  return `gid://shopify/Product/${trimmed}`;
}

function toVariantGid(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("gid://")) return trimmed;
  return `gid://shopify/ProductVariant/${trimmed}`;
}

const PRODUCT_CREATE = `
  mutation ProductCreate($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product { id handle }
      userErrors { field message }
    }
  }
`;

const PRODUCT_UPDATE = `
  mutation ProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id handle }
      userErrors { field message }
    }
  }
`;

const PRODUCT_SET = `
  mutation ProductSet($input: ProductSetInput!) {
    productSet(input: $input, synchronous: true) {
      product { id handle variants(first: 250) { edges { node { id sku inventoryItem { id } } } } }
      userErrors { field message }
    }
  }
`;

const PRODUCT_CREATE_MEDIA = `
  mutation CreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { ... on MediaImage { id image { url } } }
      mediaUserErrors { field message }
    }
  }
`;

const PRODUCT_VARIANT_APPEND_MEDIA = `
  mutation ProductVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
    productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

const MEDIA_STATUS_QUERY = `
  query MediaStatus($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on MediaImage { id status }
    }
  }
`;

const PRODUCT_MEDIA_QUERY = `
  query ProductMedia($id: ID!) {
    product(id: $id) {
      media(first: 250) {
        edges {
          node {
            id
            ... on MediaImage { image { url } }
          }
        }
      }
    }
  }
`;

const PRODUCT_VARIANTS_MEDIA_QUERY = `
  query ProductVariantsMedia($id: ID!) {
    product(id: $id) {
      variants(first: 250) {
        edges {
          node {
            id
            media(first: 50) { edges { node { id } } }
          }
        }
      }
    }
  }
`;

// Snapshot of an existing product used by the partial-update path. We pull
// only the fields we might want to update so a re-import that doesn't change
// anything makes zero mutations.
const PRODUCT_SNAPSHOT_QUERY = `
  query ProductSnapshot($id: ID!) {
    product(id: $id) {
      id
      handle
      title
      descriptionHtml
      vendor
      productType
      tags
      status
      seo { title description }
      options { id name position values }
      variants(first: 250) {
        edges {
          node {
            id
            sku
            barcode
            price
            compareAtPrice
            inventoryQuantity
            inventoryPolicy
            taxable
            selectedOptions { name value }
            inventoryItem {
              id
              tracked
              requiresShipping
              measurement { weight { unit value } }
              unitCost { amount }
              countryCodeOfOrigin
              harmonizedSystemCode
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_VARIANTS_BULK_UPDATE = `
  mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id sku inventoryItem { id } }
      userErrors { field message }
    }
  }
`;

const PRODUCT_VARIANTS_BULK_CREATE = `
  mutation ProductVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants { id sku inventoryItem { id } }
      userErrors { field message }
    }
  }
`;

// Shopify CDN URLs preserve the original filename, so we match existing media
// by filename (last path segment) to avoid re-uploading the same image on
// subsequent pushes of the same product.
function filenameOf(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() ?? "";
    return last.split("?")[0].toLowerCase();
  } catch {
    const last = url.split("/").pop() ?? "";
    return last.split("?")[0].toLowerCase();
  }
}

async function fetchVariantMediaMap(
  auth: ShopAuth,
  productId: string
): Promise<Map<string, Set<string>>> {
  type Resp = {
    data?: {
      product?: {
        variants?: {
          edges?: Array<{
            node: {
              id: string;
              media?: { edges?: Array<{ node: { id: string } }> } | null;
            };
          }>;
        } | null;
      } | null;
    };
    errors?: Array<{ message: string }>;
  };
  const out = new Map<string, Set<string>>();
  try {
    const resp = await shopifyGraphQLRequest<Resp>({
      shopDomain: auth.shopDomain,
      accessToken: auth.accessToken,
      query: PRODUCT_VARIANTS_MEDIA_QUERY,
      variables: { id: productId }
    });
    for (const edge of resp.data?.product?.variants?.edges ?? []) {
      const ids = new Set<string>();
      for (const m of edge.node.media?.edges ?? []) {
        if (m.node.id) ids.add(m.node.id);
      }
      out.set(edge.node.id, ids);
    }
  } catch {
    // best-effort
  }
  return out;
}

async function fetchExistingMediaByFilename(
  auth: ShopAuth,
  productId: string
): Promise<Map<string, string>> {
  type Resp = {
    data?: {
      product?: {
        media?: {
          edges?: Array<{ node: { id: string; image?: { url?: string | null } | null } }>;
        } | null;
      } | null;
    };
    errors?: Array<{ message: string }>;
  };
  const out = new Map<string, string>();
  try {
    const resp = await shopifyGraphQLRequest<Resp>({
      shopDomain: auth.shopDomain,
      accessToken: auth.accessToken,
      query: PRODUCT_MEDIA_QUERY,
      variables: { id: productId }
    });
    for (const edge of resp.data?.product?.media?.edges ?? []) {
      const url = edge.node.image?.url ?? "";
      const name = filenameOf(url);
      if (name && !out.has(name)) out.set(name, edge.node.id);
    }
  } catch {
    // best-effort — on failure we just skip dedupe (old behavior).
  }
  return out;
}

// Shopify processes media (downloads from URL, generates renditions) async.
// Returns the set of media IDs that reach status=READY within the timeout.
async function waitForMediaReady(
  auth: ShopAuth,
  mediaIds: string[],
  timeoutMs = 45_000
): Promise<Set<string>> {
  const ready = new Set<string>();
  const start = Date.now();
  while (Date.now() - start < timeoutMs && ready.size < mediaIds.length) {
    const pending = mediaIds.filter((id) => !ready.has(id));
    if (pending.length === 0) break;
    type Resp = {
      data?: { nodes?: Array<{ id: string; status?: string | null } | null> };
      errors?: Array<{ message: string }>;
    };
    let resp: Resp;
    try {
      resp = await shopifyGraphQLRequest<Resp>({
        shopDomain: auth.shopDomain,
        accessToken: auth.accessToken,
        query: MEDIA_STATUS_QUERY,
        variables: { ids: pending }
      });
    } catch {
      break;
    }
    for (const node of resp.data?.nodes ?? []) {
      if (node?.status === "READY") ready.add(node.id);
    }
    if (ready.size < mediaIds.length) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return ready;
}

const METAFIELDS_SET = `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

const INVENTORY_SET = `
  mutation InventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup { id }
      userErrors { field message }
    }
  }
`;

const LOCATIONS_QUERY = `
  query Locations {
    locations(first: 5) { edges { node { id isActive fulfillsOnlineOrders } } }
  }
`;

type ShopAuth = { shopDomain: string; accessToken: string };

async function loadShopAuth(storeId: bigint): Promise<ShopAuth | null> {
  const store = await getPrismaClient().store.findUnique({ where: { id: storeId } });
  if (!store?.accessTokenEncrypted) return null;
  try {
    return { shopDomain: store.shopDomain, accessToken: decryptValue(store.accessTokenEncrypted) };
  } catch {
    return null;
  }
}

async function getPrimaryLocation(auth: ShopAuth): Promise<string | null> {
  type Resp = {
    data?: { locations?: { edges?: Array<{ node: { id: string; isActive: boolean; fulfillsOnlineOrders: boolean } }> } };
  };
  const resp = await shopifyGraphQLRequest<Resp>({
    shopDomain: auth.shopDomain,
    accessToken: auth.accessToken,
    query: LOCATIONS_QUERY
  });
  const edges = resp.data?.locations?.edges ?? [];
  const active = edges.find((e) => e.node.isActive && e.node.fulfillsOnlineOrders);
  return active?.node.id ?? edges.find((e) => e.node.isActive)?.node.id ?? null;
}

async function findProductIdByHandle(auth: ShopAuth, handle: string): Promise<string | null> {
  type Resp = { data?: { products?: { edges?: Array<{ node: { id: string } }> } } };
  const resp = await shopifyGraphQLRequest<Resp>({
    shopDomain: auth.shopDomain,
    accessToken: auth.accessToken,
    query: FIND_PRODUCT_BY_HANDLE,
    variables: { query: `handle:${handle}` }
  });
  return resp.data?.products?.edges?.[0]?.node.id ?? null;
}

function statusEnum(value: string): "ACTIVE" | "DRAFT" | "ARCHIVED" {
  const v = (value || "active").toLowerCase();
  if (v === "draft") return "DRAFT";
  if (v === "archived") return "ARCHIVED";
  return "ACTIVE";
}

function normalisedOptionKey(variant: ParsedVariant): string {
  const n = (v: string | undefined) => (v ?? "").trim().toLowerCase();
  return `${n(variant.option1Value)}|${n(variant.option2Value)}|${n(variant.option3Value)}`;
}

// Final defense-in-depth: even if the parser somehow lets duplicates through,
// we collapse them here before sending productSet so Shopify never sees two
// variants with the same option-value combination. Also collapses by SKU as
// a backup — Shopify keeps SKUs unique per product, so two rows with the
// same non-empty SKU are always the same variant.
function dedupeVariantsByOptions(variants: ParsedVariant[]): ParsedVariant[] {
  const byVariantId = new Map<string, ParsedVariant>();
  const byOptionKey = new Map<string, ParsedVariant>();
  const bySku = new Map<string, ParsedVariant>();
  const merge = (target: ParsedVariant, incoming: ParsedVariant) => {
    for (const k of Object.keys(incoming) as Array<keyof ParsedVariant>) {
      const value = incoming[k];
      if (typeof value === "string" && value.trim() === "") continue;
      if (Array.isArray(value) && value.length === 0) continue;
      (target as Record<string, unknown>)[k as string] = value;
    }
  };

  for (const v of variants) {
    const idKey = (v.variantId ?? "").trim();
    const optionKey = normalisedOptionKey(v);
    const skuKey = (v.sku ?? "").trim();

    let target: ParsedVariant | undefined;
    if (idKey) target = byVariantId.get(idKey);
    if (!target) target = byOptionKey.get(optionKey);
    if (!target && skuKey) target = bySku.get(skuKey);

    if (!target) {
      const copy: ParsedVariant = { ...v };
      if (idKey) byVariantId.set(idKey, copy);
      byOptionKey.set(optionKey, copy);
      if (skuKey) bySku.set(skuKey, copy);
      continue;
    }
    merge(target, v);
    if (idKey) byVariantId.set(idKey, target);
    byOptionKey.set(optionKey, target);
    if (skuKey) bySku.set(skuKey, target);
  }
  // De-dup the resulting list (a variant could land in multiple maps).
  return Array.from(new Set([...byVariantId.values(), ...byOptionKey.values()]));
}

function variantOptionValues(
  variant: ParsedVariant,
  optionNames: string[]
): Array<{ optionName: string; name: string }> {
  const out: Array<{ optionName: string; name: string }> = [];
  if (optionNames[0]) {
    out.push({ optionName: optionNames[0], name: variant.option1Value || "Default Title" });
  }
  if (optionNames[1] && variant.option2Value) {
    out.push({ optionName: optionNames[1], name: variant.option2Value });
  }
  if (optionNames[2] && variant.option3Value) {
    out.push({ optionName: optionNames[2], name: variant.option3Value });
  }
  return out;
}

function buildProductOptions(product: ParsedProduct): Array<{ name: string; values: Array<{ name: string }> }> {
  const names = [product.option1Name, product.option2Name, product.option3Name].filter(Boolean);
  if (names.length === 0) {
    const hasOptions = product.variants.some((v) => v.option1Value || v.option2Value || v.option3Value);
    if (!hasOptions) return [];
    return [{ name: "Title", values: [{ name: "Default Title" }] }];
  }
  const uniqueByIndex: string[][] = [[], [], []];
  for (const variant of product.variants) {
    const values = [variant.option1Value, variant.option2Value, variant.option3Value];
    values.forEach((value, idx) => {
      if (value && !uniqueByIndex[idx].includes(value)) uniqueByIndex[idx].push(value);
    });
  }
  return names.map((name, idx) => ({
    name,
    values: (uniqueByIndex[idx].length ? uniqueByIndex[idx] : ["Default Title"]).map((value) => ({ name: value }))
  }));
}

function weightInGrams(variant: ParsedVariant): number | null {
  const raw = variant.weightGrams.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

type ProductSetResp = {
  data?: {
    productSet?: {
      product?: {
        id: string;
        variants: {
          edges: Array<{ node: { id: string; sku: string | null; inventoryItem: { id: string } | null } }>;
        };
      } | null;
      userErrors?: Array<{ field: string[] | null; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
};

function userErrorMessage(errors: Array<{ field: string[] | null; message: string }> | undefined): string {
  if (!errors || errors.length === 0) return "";
  return errors.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`).join("; ");
}

// Snapshot we read once per existing product for partial-update diffing.
type ProductSnapshot = {
  handle: string | null;
  title: string | null;
  descriptionHtml: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  status: string | null;
  seo: { title: string | null; description: string | null } | null;
  variants: Array<{
    id: string;
    sku: string | null;
    barcode: string | null;
    price: string | null;
    compareAtPrice: string | null;
    inventoryQuantity: number | null;
    inventoryPolicy: string | null;
    taxable: boolean | null;
    inventoryItem: {
      id: string | null;
      tracked: boolean | null;
      requiresShipping: boolean | null;
      countryCodeOfOrigin: string | null;
      harmonizedSystemCode: string | null;
      weightGrams: number | null;
      unitCostAmount: string | null;
    } | null;
  }>;
};

async function fetchProductSnapshot(auth: ShopAuth, productId: string): Promise<ProductSnapshot | null> {
  type Resp = {
    data?: {
      product?: {
        handle: string | null;
        title: string | null;
        descriptionHtml: string | null;
        vendor: string | null;
        productType: string | null;
        tags: string[] | null;
        status: string | null;
        seo: { title: string | null; description: string | null } | null;
        variants: {
          edges: Array<{
            node: {
              id: string;
              sku: string | null;
              barcode: string | null;
              price: string | null;
              compareAtPrice: string | null;
              inventoryQuantity: number | null;
              inventoryPolicy: string | null;
              taxable: boolean | null;
              inventoryItem: {
                id: string | null;
                tracked: boolean | null;
                requiresShipping: boolean | null;
                countryCodeOfOrigin: string | null;
                harmonizedSystemCode: string | null;
                measurement: { weight: { unit: string | null; value: number | null } | null } | null;
                unitCost: { amount: string | null } | null;
              } | null;
            };
          }>;
        };
      } | null;
    };
    errors?: Array<{ message: string }>;
  };
  try {
    const resp = await shopifyGraphQLRequest<Resp>({
      shopDomain: auth.shopDomain,
      accessToken: auth.accessToken,
      query: PRODUCT_SNAPSHOT_QUERY,
      variables: { id: productId }
    });
    const p = resp.data?.product;
    if (!p) return null;
    return {
      handle: p.handle,
      title: p.title,
      descriptionHtml: p.descriptionHtml,
      vendor: p.vendor,
      productType: p.productType,
      tags: p.tags ?? [],
      status: p.status,
      seo: p.seo,
      variants: p.variants.edges.map((edge) => {
        const node = edge.node;
        const weight = node.inventoryItem?.measurement?.weight;
        const grams = (() => {
          if (!weight || weight.value === null || weight.value === undefined) return null;
          const v = Number(weight.value);
          if (!Number.isFinite(v)) return null;
          const unit = (weight.unit ?? "GRAMS").toUpperCase();
          if (unit === "KILOGRAMS") return Math.round(v * 1000);
          if (unit === "POUNDS") return Math.round(v * 453.59237);
          if (unit === "OUNCES") return Math.round(v * 28.349523125);
          return Math.round(v);
        })();
        return {
          id: node.id,
          sku: node.sku,
          barcode: node.barcode,
          price: node.price,
          compareAtPrice: node.compareAtPrice,
          inventoryQuantity: node.inventoryQuantity,
          inventoryPolicy: node.inventoryPolicy,
          taxable: node.taxable,
          inventoryItem: node.inventoryItem
            ? {
                id: node.inventoryItem.id,
                tracked: node.inventoryItem.tracked,
                requiresShipping: node.inventoryItem.requiresShipping,
                countryCodeOfOrigin: node.inventoryItem.countryCodeOfOrigin,
                harmonizedSystemCode: node.inventoryItem.harmonizedSystemCode,
                weightGrams: grams,
                unitCostAmount: node.inventoryItem.unitCost?.amount ?? null
              }
            : null
        };
      })
    };
  } catch {
    return null;
  }
}

function arraysEqualIgnoringOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a.map((s) => s.trim()).filter(Boolean));
  const setB = new Set(b.map((s) => s.trim()).filter(Boolean));
  if (setA.size !== setB.size) return false;
  for (const v of setA) if (!setB.has(v)) return false;
  return true;
}

function decimalEquals(a: unknown, b: unknown): boolean {
  if (a === undefined || a === null || a === "") return b === undefined || b === null || b === "";
  if (b === undefined || b === null || b === "") return false;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return String(a) === String(b);
  return Math.abs(na - nb) < 1e-6;
}

async function pushOneProduct(
  auth: ShopAuth,
  product: ParsedProduct,
  locationId: string | null,
  resolver: DestinationResolver
): Promise<PushOutcome> {
  // 1. Resolve product ID (find or create stub). When the CSV row carries an
  // explicit Shopify product ID we trust it — that's how a handle rename works
  // (the old handle would no longer match a find-by-handle lookup).
  let productId: string | null = product.productId ? toProductGid(product.productId) : null;
  if (!productId) {
    productId = await findProductIdByHandle(auth, product.handle);
  }
  // Track whether this product existed in Shopify before this push. We use
  // this further down to skip the image-upload phase entirely for already-
  // existing products — otherwise re-imports of the same CSV (with different
  // source URLs) would accumulate duplicate media.
  const productExistedBefore = Boolean(productId);

  // Container for the variant list we'll attach media / inventory / metafields
  // to later. Populated by either the new-product path (from productSet) or
  // the existing-product path (from the snapshot + bulkCreate response).
  type CreatedVariant = { node: { id: string; sku: string | null; inventoryItem: { id: string } | null } };
  let createdVariants: CreatedVariant[] = [];

  if (!productId) {
    // ---- NEW PRODUCT PATH: productCreate stub, then productSet wholesale ----
    type Resp = {
      data?: { productCreate?: { product?: { id: string } | null; userErrors?: Array<{ field: string[] | null; message: string }> } };
      errors?: Array<{ message: string }>;
    };
    const resp = await shopifyGraphQLRequest<Resp>({
      shopDomain: auth.shopDomain,
      accessToken: auth.accessToken,
      query: PRODUCT_CREATE,
      variables: {
        product: {
          handle: product.handle,
          title: product.title || product.handle,
          status: statusEnum(product.status)
        }
      }
    });
    const errs = userErrorMessage(resp.data?.productCreate?.userErrors);
    if (errs) return { handle: product.handle, ok: false, message: `productCreate: ${errs}` };
    if (resp.errors?.length) {
      return { handle: product.handle, ok: false, message: `productCreate: ${resp.errors.map((e) => e.message).join("; ")}` };
    }
    productId = resp.data?.productCreate?.product?.id ?? null;
    if (!productId) return { handle: product.handle, ok: false, message: "productCreate returned no id" };

    const productOptions = buildProductOptions(product);
    const optionNames = [product.option1Name, product.option2Name, product.option3Name].filter(Boolean);
    const productSetInput: Record<string, unknown> = {
      id: productId,
      handle: product.handle,
      title: product.title || product.handle,
      descriptionHtml: product.bodyHtml,
      vendor: product.vendor,
      productType: product.productType,
      tags: product.tags,
      status: statusEnum(product.status),
      seo: { title: product.seoTitle, description: product.seoDescription },
      productOptions: productOptions.length ? productOptions : undefined,
      variants: dedupeVariantsByOptions(product.variants).map((variant) => {
        const optionValues =
          productOptions.length === 0
            ? []
            : variantOptionValues(variant, productOptions.length ? productOptions.map((o) => o.name) : optionNames);
        const grams = weightInGrams(variant);
        return {
          sku: variant.sku || undefined,
          barcode: variant.barcode || undefined,
          price: variant.price || undefined,
          compareAtPrice: variant.compareAtPrice || undefined,
          taxable: variant.taxable ? /^(true|yes|1)$/i.test(variant.taxable) : undefined,
          inventoryPolicy: (variant.inventoryPolicy || "deny").toUpperCase(),
          inventoryItem: {
            tracked: variant.inventoryTracker.toLowerCase() === "shopify" ? true : undefined,
            requiresShipping: variant.requiresShipping ? /^(true|yes|1)$/i.test(variant.requiresShipping) : undefined,
            cost: variant.costPerItem || undefined,
            countryCodeOfOrigin: variant.countryOfOrigin || undefined,
            harmonizedSystemCode: variant.harmonizedSystemCode || undefined,
            measurement: grams !== null ? { weight: { unit: "GRAMS", value: grams } } : undefined
          },
          optionValues: optionValues.length ? optionValues : undefined
        };
      })
    };

    const setResp = await shopifyGraphQLRequest<ProductSetResp>({
      shopDomain: auth.shopDomain,
      accessToken: auth.accessToken,
      query: PRODUCT_SET,
      variables: { input: productSetInput }
    });
    const setErrs = userErrorMessage(setResp.data?.productSet?.userErrors);
    if (setErrs) return { handle: product.handle, ok: false, message: `productSet: ${setErrs}`, productId };
    if (setResp.errors?.length) {
      return {
        handle: product.handle,
        ok: false,
        message: `productSet: ${setResp.errors.map((e) => e.message).join("; ")}`,
        productId
      };
    }
    createdVariants = setResp.data?.productSet?.product?.variants.edges ?? [];
  } else {
    // ---- EXISTING PRODUCT PATH: Shopify-style partial update ----
    // Pull current snapshot; if we can't read it, fall back to a conservative
    // productUpdate without variant changes (we don't want to wipe variants).
    const snapshot = await fetchProductSnapshot(auth, productId);
    // When the row pinned the product by ID (rather than handle lookup) and
    // Shopify says no such product exists, surface that as a hard error
    // instead of silently doing nothing. Most common cause: Excel rounded
    // the long numeric ID to scientific notation when the CSV was saved.
    if (!snapshot && product.productId) {
      return {
        handle: product.handle,
        ok: false,
        message:
          `Product ID ${product.productId} not found in Shopify. ` +
          `If you opened the CSV in Excel, it may have rounded the ID — ` +
          `re-export and open in Google Sheets or set the ID column to Text.`,
        productId
      };
    }

    // Diff the product-level fields. Partial-update semantics: only patch a
    // field if the CSV row actually carried a value for it. An empty cell
    // means "leave alone" — never "clear" — so users can submit narrow
    // CSVs (e.g. ID + new Handle only) without wiping unrelated fields.
    const productPatch: Record<string, unknown> = { id: productId };
    let productPatched = false;
    // Handle rename: only meaningful when the CSV row pinned the product by
    // ID. If the row lacked an ID we already used the handle to find the
    // product, so it can't differ.
    if (snapshot && product.productId && product.handle && snapshot.handle !== product.handle) {
      productPatch.handle = product.handle;
      productPatched = true;
    }
    if (snapshot && product.title && snapshot.title !== product.title) {
      productPatch.title = product.title;
      productPatched = true;
    }
    if (snapshot && product.bodyHtml && (snapshot.descriptionHtml ?? "") !== product.bodyHtml) {
      productPatch.descriptionHtml = product.bodyHtml;
      productPatched = true;
    }
    if (snapshot && product.vendor && (snapshot.vendor ?? "") !== product.vendor) {
      productPatch.vendor = product.vendor;
      productPatched = true;
    }
    if (snapshot && product.productType && (snapshot.productType ?? "") !== product.productType) {
      productPatch.productType = product.productType;
      productPatched = true;
    }
    if (snapshot && product.tags.length > 0 && !arraysEqualIgnoringOrder(snapshot.tags, product.tags)) {
      productPatch.tags = product.tags;
      productPatched = true;
    }
    if (snapshot && product.status) {
      const incomingStatus = statusEnum(product.status);
      if ((snapshot.status ?? "").toUpperCase() !== incomingStatus) {
        productPatch.status = incomingStatus;
        productPatched = true;
      }
    }
    if (snapshot && (product.seoTitle || product.seoDescription)) {
      // Only patch SEO if the user provided at least one of the two fields.
      // Preserve the other side from the snapshot so we don't accidentally
      // blank out a field the CSV didn't carry.
      const incomingSeoTitle = product.seoTitle || snapshot.seo?.title || "";
      const incomingSeoDesc = product.seoDescription || snapshot.seo?.description || "";
      const currentSeoTitle = snapshot.seo?.title ?? "";
      const currentSeoDesc = snapshot.seo?.description ?? "";
      if (currentSeoTitle !== incomingSeoTitle || currentSeoDesc !== incomingSeoDesc) {
        productPatch.seo = { title: incomingSeoTitle, description: incomingSeoDesc };
        productPatched = true;
      }
    }

    if (productPatched) {
      type UpdResp = {
        data?: { productUpdate?: { userErrors?: Array<{ field: string[] | null; message: string }> } };
        errors?: Array<{ message: string }>;
      };
      const resp = await shopifyGraphQLRequest<UpdResp>({
        shopDomain: auth.shopDomain,
        accessToken: auth.accessToken,
        query: PRODUCT_UPDATE,
        variables: { product: productPatch }
      });
      const errs = userErrorMessage(resp.data?.productUpdate?.userErrors);
      if (errs) return { handle: product.handle, ok: false, message: `productUpdate: ${errs}` };
      if (resp.errors?.length) {
        return { handle: product.handle, ok: false, message: `productUpdate: ${resp.errors.map((e) => e.message).join("; ")}` };
      }
    }

    // Variant diff. Match incoming variants to existing by Variant ID first
    // (so SKU renames are safe), then fall back to SKU. For matched ones,
    // only patch fields that actually changed. Variants that exist in
    // Shopify but not in the CSV are LEFT ALONE — Shopify's bulk import has
    // the same additive behaviour.
    const incomingVariants = dedupeVariantsByOptions(product.variants);
    const existingById = new Map<string, ProductSnapshot["variants"][number]>();
    const existingBySku = new Map<string, ProductSnapshot["variants"][number]>();
    for (const v of snapshot?.variants ?? []) {
      existingById.set(v.id, v);
      if (v.sku) existingBySku.set(v.sku.trim(), v);
    }

    const variantPatches: Array<Record<string, unknown>> = [];
    const variantsToCreate: ParsedVariant[] = [];
    for (const incoming of incomingVariants) {
      const variantGid = incoming.variantId ? toVariantGid(incoming.variantId) : "";
      const sku = (incoming.sku ?? "").trim();
      const existing =
        (variantGid && existingById.get(variantGid)) ||
        (sku ? existingBySku.get(sku) : undefined);
      if (!existing) {
        variantsToCreate.push(incoming);
        continue;
      }
      const patch: Record<string, unknown> = { id: existing.id };
      let changed = false;
      // SKU rename: only allow when the row pinned the variant by ID.
      if (incoming.variantId && sku && (existing.sku ?? "") !== sku) {
        patch.sku = sku;
        changed = true;
      }
      if (incoming.price && !decimalEquals(existing.price, incoming.price)) {
        patch.price = incoming.price;
        changed = true;
      }
      if (incoming.compareAtPrice && !decimalEquals(existing.compareAtPrice, incoming.compareAtPrice)) {
        patch.compareAtPrice = incoming.compareAtPrice;
        changed = true;
      }
      if (incoming.barcode && existing.barcode !== incoming.barcode) {
        patch.barcode = incoming.barcode;
        changed = true;
      }
      if (incoming.taxable) {
        const incomingTaxable = /^(true|yes|1)$/i.test(incoming.taxable);
        if (existing.taxable !== incomingTaxable) {
          patch.taxable = incomingTaxable;
          changed = true;
        }
      }
      if (incoming.inventoryPolicy) {
        const incomingPolicy = incoming.inventoryPolicy.toUpperCase();
        if ((existing.inventoryPolicy ?? "").toUpperCase() !== incomingPolicy) {
          patch.inventoryPolicy = incomingPolicy;
          changed = true;
        }
      }
      const inventoryItemPatch: Record<string, unknown> = {};
      const grams = weightInGrams(incoming);
      if (grams !== null && existing.inventoryItem?.weightGrams !== grams) {
        inventoryItemPatch.measurement = { weight: { unit: "GRAMS", value: grams } };
      }
      if (incoming.costPerItem && !decimalEquals(existing.inventoryItem?.unitCostAmount ?? null, incoming.costPerItem)) {
        inventoryItemPatch.cost = incoming.costPerItem;
      }
      if (
        incoming.countryOfOrigin &&
        existing.inventoryItem?.countryCodeOfOrigin !== incoming.countryOfOrigin
      ) {
        inventoryItemPatch.countryCodeOfOrigin = incoming.countryOfOrigin;
      }
      if (
        incoming.harmonizedSystemCode &&
        existing.inventoryItem?.harmonizedSystemCode !== incoming.harmonizedSystemCode
      ) {
        inventoryItemPatch.harmonizedSystemCode = incoming.harmonizedSystemCode;
      }
      if (incoming.requiresShipping) {
        const incomingShip = /^(true|yes|1)$/i.test(incoming.requiresShipping);
        if (existing.inventoryItem?.requiresShipping !== incomingShip) {
          inventoryItemPatch.requiresShipping = incomingShip;
        }
      }
      if (incoming.inventoryTracker) {
        const incomingTracked = incoming.inventoryTracker.toLowerCase() === "shopify";
        if (existing.inventoryItem?.tracked !== incomingTracked) {
          inventoryItemPatch.tracked = incomingTracked;
        }
      }
      if (Object.keys(inventoryItemPatch).length > 0) {
        patch.inventoryItem = inventoryItemPatch;
        changed = true;
      }
      if (changed) variantPatches.push(patch);
    }

    if (variantPatches.length > 0) {
      type Resp = {
        data?: {
          productVariantsBulkUpdate?: {
            productVariants?: Array<{ id: string; sku: string | null; inventoryItem: { id: string } | null }>;
            userErrors?: Array<{ field: string[] | null; message: string }>;
          };
        };
        errors?: Array<{ message: string }>;
      };
      // bulkUpdate can take many variants per call.
      const resp = await shopifyGraphQLRequest<Resp>({
        shopDomain: auth.shopDomain,
        accessToken: auth.accessToken,
        query: PRODUCT_VARIANTS_BULK_UPDATE,
        variables: { productId, variants: variantPatches }
      });
      const errs = userErrorMessage(resp.data?.productVariantsBulkUpdate?.userErrors);
      if (errs) {
        return { handle: product.handle, ok: false, message: `productVariantsBulkUpdate: ${errs}`, productId };
      }
    }

    if (variantsToCreate.length > 0) {
      const optionNames = [product.option1Name, product.option2Name, product.option3Name].filter(Boolean);
      const createInputs = variantsToCreate.map((variant) => {
        const grams = weightInGrams(variant);
        const optionValues = variantOptionValues(variant, optionNames);
        return {
          sku: variant.sku || undefined,
          barcode: variant.barcode || undefined,
          price: variant.price || undefined,
          compareAtPrice: variant.compareAtPrice || undefined,
          taxable: variant.taxable ? /^(true|yes|1)$/i.test(variant.taxable) : undefined,
          inventoryPolicy: (variant.inventoryPolicy || "deny").toUpperCase(),
          inventoryItem: {
            tracked: variant.inventoryTracker.toLowerCase() === "shopify" ? true : undefined,
            requiresShipping: variant.requiresShipping ? /^(true|yes|1)$/i.test(variant.requiresShipping) : undefined,
            cost: variant.costPerItem || undefined,
            countryCodeOfOrigin: variant.countryOfOrigin || undefined,
            harmonizedSystemCode: variant.harmonizedSystemCode || undefined,
            measurement: grams !== null ? { weight: { unit: "GRAMS", value: grams } } : undefined
          },
          optionValues: optionValues.length ? optionValues : undefined
        };
      });
      type Resp = {
        data?: {
          productVariantsBulkCreate?: {
            productVariants?: Array<{ id: string; sku: string | null; inventoryItem: { id: string } | null }>;
            userErrors?: Array<{ field: string[] | null; message: string }>;
          };
        };
        errors?: Array<{ message: string }>;
      };
      const resp = await shopifyGraphQLRequest<Resp>({
        shopDomain: auth.shopDomain,
        accessToken: auth.accessToken,
        query: PRODUCT_VARIANTS_BULK_CREATE,
        variables: { productId, variants: createInputs }
      });
      const errs = userErrorMessage(resp.data?.productVariantsBulkCreate?.userErrors);
      if (errs) {
        console.warn(`[import-push] productVariantsBulkCreate for ${product.handle}: ${errs}`);
      }
    }

    // Re-fetch the variant list so downstream phases (media attach, inventory,
    // metafields) see the full set including any newly-created ones.
    const refreshed = await fetchProductSnapshot(auth, productId);
    createdVariants = (refreshed?.variants ?? []).map((v) => ({
      node: {
        id: v.id,
        sku: v.sku,
        inventoryItem: v.inventoryItem?.id ? { id: v.inventoryItem.id } : null
      }
    }));
  }

  // 3. Images via productCreateMedia. We build a union of every URL referenced
  //    by either a product image OR a variant image, dedupe it, upload them all,
  //    and capture the resulting MediaImage GIDs so step 3b can attach each
  //    variant's image to its variant.
  let imagesCreated = 0;
  const mediaIdBySourceUrl = new Map<string, string>();
  const orderedUrls: string[] = [];
  const altTextByUrl = new Map<string, string>();
  for (const img of product.images) {
    const src = (img.src ?? "").trim();
    if (!src) continue;
    if (!altTextByUrl.has(src)) {
      orderedUrls.push(src);
      altTextByUrl.set(src, img.altText ?? "");
    }
  }
  for (const variant of product.variants) {
    const url = (variant.variantImage ?? "").trim();
    if (!url) continue;
    if (!altTextByUrl.has(url)) {
      orderedUrls.push(url);
      altTextByUrl.set(url, "");
    }
  }

  if (orderedUrls.length > 0) {
    // Fetch existing media so we can (a) reuse GIDs for variant-image attach,
    // and (b) skip URLs whose filename already matches a Shopify-side image.
    // Shopify CDN preserves the original filename, so a re-uploaded export
    // dedupes cleanly. Brand-new URLs the operator added in the CSV get
    // uploaded as new media — that's how round-trip image edits work.
    const existingByFilename = await fetchExistingMediaByFilename(auth, productId);
    const urlsToUpload: string[] = [];
    for (const url of orderedUrls) {
      const existingId = existingByFilename.get(filenameOf(url));
      if (existingId) {
        mediaIdBySourceUrl.set(url, existingId);
      } else {
        urlsToUpload.push(url);
      }
    }

    if (urlsToUpload.length > 0) {
      type Resp = {
        data?: {
          productCreateMedia?: {
            media?: Array<{ id: string; image?: { url: string | null } | null } | null>;
            mediaUserErrors?: Array<{ field: string[] | null; message: string }>;
          };
        };
        errors?: Array<{ message: string }>;
      };
      const mediaInputs = urlsToUpload.map((url) => ({
        originalSource: url,
        alt: altTextByUrl.get(url) ?? "",
        mediaContentType: "IMAGE"
      }));
      const resp = await shopifyGraphQLRequest<Resp>({
        shopDomain: auth.shopDomain,
        accessToken: auth.accessToken,
        query: PRODUCT_CREATE_MEDIA,
        variables: { productId, media: mediaInputs }
      });
      if (resp.errors?.length || resp.data?.productCreateMedia?.mediaUserErrors?.length) {
        const issues = [
          ...(resp.errors?.map((e) => e.message) ?? []),
          ...(resp.data?.productCreateMedia?.mediaUserErrors?.map(
            (e) => `${(e.field ?? []).join(".")}: ${e.message}`
          ) ?? [])
        ].join("; ");
        console.warn(`[import-push] productCreateMedia issues for ${product.handle}: ${issues}`);
      }
      const returned = resp.data?.productCreateMedia?.media ?? [];
      mediaInputs.forEach((input, idx) => {
        const node = returned[idx];
        if (node?.id) mediaIdBySourceUrl.set(input.originalSource, node.id);
      });
    }
    imagesCreated = mediaIdBySourceUrl.size;
  }

  // 3b. Variant images — attach the uploaded media to the right variant.
  // Falls back to matching the variantImage URL against the product.images list
  // by index if the exact URL isn't in the lookup map.
  const productImageUrlToIndex = new Map<string, number>();
  product.images.forEach((img, idx) => {
    if (img.src) productImageUrlToIndex.set(img.src.trim(), idx);
  });
  const uploadedMediaIdsInOrder: string[] = orderedUrls
    .map((url) => mediaIdBySourceUrl.get(url))
    .filter((id): id is string => Boolean(id));

  const dedupedForAttach = dedupeVariantsByOptions(product.variants);
  const variantMediaAssignments: Array<{ variantId: string; mediaIds: string[] }> = [];
  let variantImagesUnmatched = 0;
  dedupedForAttach.forEach((parsedVariant, idx) => {
    const url = (parsedVariant.variantImage ?? "").trim();
    if (!url) return;
    let mediaId = mediaIdBySourceUrl.get(url);
    if (!mediaId) {
      // Fallback: align by index against product images.
      const positionalIdx = productImageUrlToIndex.get(url);
      if (positionalIdx !== undefined && uploadedMediaIdsInOrder[positionalIdx]) {
        mediaId = uploadedMediaIdsInOrder[positionalIdx];
      }
    }
    if (!mediaId) {
      variantImagesUnmatched++;
      return;
    }
    const parsedGid = parsedVariant.variantId ? toVariantGid(parsedVariant.variantId) : "";
    const matched =
      (parsedGid && createdVariants.find((edge) => edge.node.id === parsedGid)) ||
      (parsedVariant.sku ? createdVariants.find((edge) => edge.node.sku === parsedVariant.sku) : undefined) ||
      createdVariants[idx];
    const variantGid = matched?.node.id;
    if (!variantGid) {
      variantImagesUnmatched++;
      return;
    }
    variantMediaAssignments.push({ variantId: variantGid, mediaIds: [mediaId] });
  });

  let variantImagesAttached = 0;
  if (variantMediaAssignments.length > 0) {
    // Skip assignments whose target media is already linked to the variant —
    // productVariantAppendMedia is not idempotent and would create duplicate
    // variant-image links on repeated pushes.
    const existingVariantMedia = await fetchVariantMediaMap(auth, productId);
    const filteredAssignments = variantMediaAssignments.filter((v) => {
      const existing = existingVariantMedia.get(v.variantId);
      if (!existing) return true;
      return !v.mediaIds.every((id) => existing.has(id));
    });

    if (filteredAssignments.length === 0) {
      // Nothing new to attach — every variant already has its image.
    }

    // Wait for the relevant media items to finish Shopify-side processing
    // before attaching them to variants.
    const neededMediaIds = Array.from(
      new Set(filteredAssignments.flatMap((v) => v.mediaIds))
    );
    const readyIds = neededMediaIds.length > 0 ? await waitForMediaReady(auth, neededMediaIds) : new Set<string>();
    const readyAssignments = filteredAssignments.filter((v) =>
      v.mediaIds.every((id) => readyIds.has(id))
    );

    if (readyAssignments.length < variantMediaAssignments.length) {
      console.warn(
        `[import-push] ${variantMediaAssignments.length - readyAssignments.length} variant-image attach(es) skipped for ${product.handle} (media not ready in time)`
      );
    }

    if (readyAssignments.length > 0) {
      type Resp = {
        data?: { productVariantAppendMedia?: { userErrors?: Array<{ field: string[] | null; message: string }> } };
        errors?: Array<{ message: string }>;
      };
      const resp = await shopifyGraphQLRequest<Resp>({
        shopDomain: auth.shopDomain,
        accessToken: auth.accessToken,
        query: PRODUCT_VARIANT_APPEND_MEDIA,
        variables: { productId, variantMedia: readyAssignments }
      });
      const errs = userErrorMessage(resp.data?.productVariantAppendMedia?.userErrors);
      if (errs || resp.errors?.length) {
        console.warn(
          `[import-push] productVariantAppendMedia for ${product.handle} returned errors: ${
            errs || resp.errors?.map((e) => e.message).join("; ")
          }`
        );
      } else {
        variantImagesAttached = readyAssignments.length;
      }
    }
  }
  if (variantImagesUnmatched > 0) {
    console.warn(
      `[import-push] ${variantImagesUnmatched} variant image(s) for ${product.handle} could not be matched to uploaded media`
    );
  }

  // 4. Metafields via metafieldsSet (product + variants).
  let metafieldsSet = 0;
  const mfInputs: Array<Record<string, unknown>> = [];

  async function buildMfInput(
    ownerId: string,
    mf: { namespace: string; key: string; type: string; value: string; ref?: string }
  ): Promise<Record<string, unknown> | null> {
    let value = mf.value;
    if (isReferenceType(mf.type) && mf.ref) {
      const resolved = await resolver.resolveValue(mf.value, mf.type, mf.ref);
      if (!resolved) {
        // Couldn't resolve in destination — skip rather than write a broken GID.
        return null;
      }
      value = resolved;
    }
    return { ownerId, namespace: mf.namespace, key: mf.key, type: mf.type, value };
  }

  for (const mf of product.metafields) {
    const input = await buildMfInput(productId, mf);
    if (input) mfInputs.push(input);
  }
  // Map parsed variants to created variant IDs by SKU when available, else by index order.
  const variantsByIndex = createdVariants;
  for (let idx = 0; idx < product.variants.length; idx++) {
    const parsedVariant = product.variants[idx];
    if (parsedVariant.metafields.length === 0) continue;
    const parsedGid = parsedVariant.variantId ? toVariantGid(parsedVariant.variantId) : "";
    const matched =
      (parsedGid && variantsByIndex.find((edge) => edge.node.id === parsedGid)) ||
      (parsedVariant.sku ? variantsByIndex.find((edge) => edge.node.sku === parsedVariant.sku) : undefined) ||
      variantsByIndex[idx];
    const variantGid = matched?.node.id;
    if (!variantGid) continue;
    for (const mf of parsedVariant.metafields) {
      const input = await buildMfInput(variantGid, mf);
      if (input) mfInputs.push(input);
    }
  }
  if (mfInputs.length > 0) {
    type Resp = {
      data?: { metafieldsSet?: { userErrors?: Array<{ field: string[] | null; message: string }> } };
      errors?: Array<{ message: string }>;
    };
    // Shopify caps metafieldsSet at 25 per call.
    for (let i = 0; i < mfInputs.length; i += 25) {
      const slice = mfInputs.slice(i, i + 25);
      const resp = await shopifyGraphQLRequest<Resp>({
        shopDomain: auth.shopDomain,
        accessToken: auth.accessToken,
        query: METAFIELDS_SET,
        variables: { metafields: slice }
      });
      if (!resp.errors?.length && !resp.data?.metafieldsSet?.userErrors?.length) {
        metafieldsSet += slice.length;
      }
    }
  }

  // 5. Inventory levels via inventorySetQuantities (per variant with a number).
  if (locationId) {
    // For existing products we re-fetch current inventoryQuantity per variant
    // so we can skip the write when the CSV already matches Shopify. New
    // products always need the initial set.
    const currentQtyBySku = new Map<string, number | null>();
    if (productExistedBefore) {
      const snap = await fetchProductSnapshot(auth, productId);
      for (const v of snap?.variants ?? []) {
        if (v.sku) currentQtyBySku.set(v.sku.trim(), v.inventoryQuantity ?? null);
      }
    }
    const inventories: Array<{ inventoryItemId: string; locationId: string; quantity: number }> = [];
    product.variants.forEach((parsedVariant, idx) => {
      const qty = Number(parsedVariant.inventoryQuantity);
      if (!Number.isFinite(qty) || parsedVariant.inventoryQuantity.trim() === "") return;
      const parsedGid = parsedVariant.variantId ? toVariantGid(parsedVariant.variantId) : "";
      const matched =
        (parsedGid && variantsByIndex.find((edge) => edge.node.id === parsedGid)) ||
        (parsedVariant.sku ? variantsByIndex.find((edge) => edge.node.sku === parsedVariant.sku) : undefined) ||
        variantsByIndex[idx];
      const invItem = matched?.node.inventoryItem?.id;
      if (!invItem) return;
      // Skip the write if Shopify already has the same quantity.
      if (productExistedBefore && parsedVariant.sku) {
        const existing = currentQtyBySku.get(parsedVariant.sku.trim());
        if (existing !== undefined && existing === qty) return;
      }
      inventories.push({ inventoryItemId: invItem, locationId, quantity: qty });
    });
    if (inventories.length > 0) {
      type Resp = {
        data?: { inventorySetQuantities?: { userErrors?: Array<{ field: string[] | null; message: string }> } };
        errors?: Array<{ message: string }>;
      };
      // Cap at 250 per call.
      for (let i = 0; i < inventories.length; i += 250) {
        const slice = inventories.slice(i, i + 250);
        await shopifyGraphQLRequest<Resp>({
          shopDomain: auth.shopDomain,
          accessToken: auth.accessToken,
          query: INVENTORY_SET,
          variables: {
            input: {
              reason: "correction",
              name: "available",
              ignoreCompareQuantity: true,
              referenceDocumentUri: "app://bulk-import",
              quantities: slice
            }
          }
        });
      }
    }
  }

  return {
    handle: product.handle,
    ok: true,
    message: `Pushed ${product.handle}: ${dedupedForAttach.length} variant(s), ${imagesCreated} image(s), ${variantImagesAttached} variant-image link(s), ${metafieldsSet} metafield(s)`,
    productId,
    variantsCreated: dedupedForAttach.length,
    imagesCreated,
    metafieldsSet
  };
}

export type PushProgress = {
  index: number; // 0-based
  total: number;
  ok: number;
  failed: number;
  outcome: PushOutcome;
};

export type PushOptions = {
  onProgress?: (progress: PushProgress) => void | Promise<void>;
  shouldCancel?: () => boolean | Promise<boolean>;
};

export async function pushParsedProducts(
  storeId: bigint,
  products: ParsedProduct[],
  options: PushOptions = {}
): Promise<{
  outcomes: PushOutcome[];
  totals: { ok: number; failed: number; cancelled?: boolean };
}> {
  const auth = await loadShopAuth(storeId);
  if (!auth) {
    return {
      outcomes: products.map((p) => ({ handle: p.handle, ok: false, message: "Store not connected" })),
      totals: { ok: 0, failed: products.length }
    };
  }
  const locationId = await getPrimaryLocation(auth);
  const resolver = new DestinationResolver(auth);
  const outcomes: PushOutcome[] = [];
  let ok = 0;
  let failed = 0;
  let cancelled = false;
  for (let i = 0; i < products.length; i++) {
    if (options.shouldCancel && (await options.shouldCancel())) {
      cancelled = true;
      break;
    }
    const product = products[i];
    let outcome: PushOutcome;
    try {
      outcome = await pushOneProduct(auth, product, locationId, resolver);
    } catch (error) {
      outcome = {
        handle: product.handle,
        ok: false,
        message: error instanceof Error ? error.message : "Unknown error"
      };
    }
    outcomes.push(outcome);
    if (outcome.ok) ok += 1;
    else failed += 1;
    try {
      await options.onProgress?.({ index: i, total: products.length, ok, failed, outcome });
    } catch {
      // never let progress reporting break the push
    }
  }
  return { outcomes, totals: { ok, failed, cancelled } };
}
