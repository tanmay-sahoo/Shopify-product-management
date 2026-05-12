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
    const optionKey = normalisedOptionKey(v);
    const skuKey = (v.sku ?? "").trim();

    let target = byOptionKey.get(optionKey);
    if (!target && skuKey) target = bySku.get(skuKey);

    if (!target) {
      const copy: ParsedVariant = { ...v };
      byOptionKey.set(optionKey, copy);
      if (skuKey) bySku.set(skuKey, copy);
      continue;
    }
    merge(target, v);
    byOptionKey.set(optionKey, target);
    if (skuKey) bySku.set(skuKey, target);
  }
  // De-dup the resulting list (a variant could land in both maps).
  return Array.from(new Set(byOptionKey.values()));
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

async function pushOneProduct(
  auth: ShopAuth,
  product: ParsedProduct,
  locationId: string | null,
  resolver: DestinationResolver
): Promise<PushOutcome> {
  // 1. Resolve product ID (find or create stub).
  let productId = await findProductIdByHandle(auth, product.handle);

  if (!productId) {
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
  } else {
    // Sync title/status/etc. via productUpdate. Skip metafields here — handled by metafieldsSet below.
    type Resp = {
      data?: { productUpdate?: { userErrors?: Array<{ field: string[] | null; message: string }> } };
      errors?: Array<{ message: string }>;
    };
    const input: Record<string, unknown> = {
      id: productId,
      title: product.title || product.handle,
      descriptionHtml: product.bodyHtml || undefined,
      vendor: product.vendor || undefined,
      productType: product.productType || undefined,
      status: statusEnum(product.status),
      tags: product.tags,
      seo: { title: product.seoTitle || undefined, description: product.seoDescription || undefined }
    };
    const resp = await shopifyGraphQLRequest<Resp>({
      shopDomain: auth.shopDomain,
      accessToken: auth.accessToken,
      query: PRODUCT_UPDATE,
      variables: { product: input }
    });
    const errs = userErrorMessage(resp.data?.productUpdate?.userErrors);
    if (errs) return { handle: product.handle, ok: false, message: `productUpdate: ${errs}` };
  }

  // 2. Replace product structure + variants via productSet.
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
          measurement:
            grams !== null
              ? { weight: { unit: "GRAMS", value: grams } }
              : undefined
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

  const createdVariants = setResp.data?.productSet?.product?.variants.edges ?? [];

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
    type Resp = {
      data?: {
        productCreateMedia?: {
          media?: Array<{ id: string; image?: { url: string | null } | null } | null>;
          mediaUserErrors?: Array<{ field: string[] | null; message: string }>;
        };
      };
      errors?: Array<{ message: string }>;
    };
    const mediaInputs = orderedUrls.map((url) => ({
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
    const matched = parsedVariant.sku
      ? createdVariants.find((edge) => edge.node.sku === parsedVariant.sku)
      : createdVariants[idx];
    const variantGid = matched?.node.id;
    if (!variantGid) {
      variantImagesUnmatched++;
      return;
    }
    variantMediaAssignments.push({ variantId: variantGid, mediaIds: [mediaId] });
  });

  let variantImagesAttached = 0;
  if (variantMediaAssignments.length > 0) {
    // Wait for the relevant media items to finish Shopify-side processing
    // before attaching them to variants.
    const neededMediaIds = Array.from(
      new Set(variantMediaAssignments.flatMap((v) => v.mediaIds))
    );
    const readyIds = await waitForMediaReady(auth, neededMediaIds);
    const readyAssignments = variantMediaAssignments.filter((v) =>
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
    const matched = parsedVariant.sku
      ? variantsByIndex.find((edge) => edge.node.sku === parsedVariant.sku)
      : variantsByIndex[idx];
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
    const inventories: Array<{ inventoryItemId: string; locationId: string; quantity: number }> = [];
    product.variants.forEach((parsedVariant, idx) => {
      const qty = Number(parsedVariant.inventoryQuantity);
      if (!Number.isFinite(qty) || parsedVariant.inventoryQuantity.trim() === "") return;
      const matched = parsedVariant.sku
        ? variantsByIndex.find((edge) => edge.node.sku === parsedVariant.sku)
        : variantsByIndex[idx];
      const invItem = matched?.node.inventoryItem?.id;
      if (!invItem) return;
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

export async function pushParsedProducts(storeId: bigint, products: ParsedProduct[]): Promise<{
  outcomes: PushOutcome[];
  totals: { ok: number; failed: number };
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
  for (const product of products) {
    try {
      const outcome = await pushOneProduct(auth, product, locationId, resolver);
      outcomes.push(outcome);
    } catch (error) {
      outcomes.push({
        handle: product.handle,
        ok: false,
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
  const ok = outcomes.filter((o) => o.ok).length;
  return { outcomes, totals: { ok, failed: outcomes.length - ok } };
}
