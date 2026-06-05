// Pushes parsed collection rows into Shopify as partial updates. For each row:
//  - collectionUpdate with only the fields the CSV carried (never ruleSet /
//    products, so smart-collection rules and membership are never touched)
//  - metafieldsSet for any collection metafields
//
// Update-existing-only: every row is matched by Collection ID. Best-effort,
// per-row — errors are reported back so a partial run still produces output.

import { decryptValue } from "@/lib/oauth";
import { getPrismaClient } from "@/lib/prisma";
import { shopifyGraphQLRequest } from "@/lib/shopify";
import { DestinationResolver } from "@/lib/import-references";

import type { ParsedCollection } from "@/lib/collections-import-parser";

const REFERENCE_TYPE_RE = /^(list\.)?(metaobject|product|variant|collection|file|page)_reference$/;
function isReferenceType(type: string): boolean {
  return REFERENCE_TYPE_RE.test(type);
}

type ShopAuth = { shopDomain: string; accessToken: string };

function toCollectionGid(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("gid://")) return trimmed;
  return `gid://shopify/Collection/${trimmed}`;
}

const COLLECTION_SEO_QUERY = `
  query CollectionSeo($id: ID!) {
    collection(id: $id) {
      id
      seo { title description }
    }
  }
`;

const COLLECTION_UPDATE = `
  mutation CollectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection { id }
      userErrors { field message }
    }
  }
`;

const METAFIELDS_SET = `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

async function loadShopAuth(storeId: bigint): Promise<ShopAuth | null> {
  const store = await getPrismaClient().store.findUnique({ where: { id: storeId } });
  if (!store?.accessTokenEncrypted) return null;
  try {
    return { shopDomain: store.shopDomain, accessToken: decryptValue(store.accessTokenEncrypted) };
  } catch {
    return null;
  }
}

export type CollectionPushOutcome = {
  id: string;
  title: string;
  ok: boolean;
  message: string;
};

export type CollectionPushProgress = {
  index: number; // 0-based
  total: number;
  ok: number;
  failed: number;
  outcome: CollectionPushOutcome;
};

export type CollectionPushOptions = {
  onProgress?: (progress: CollectionPushProgress) => void | Promise<void>;
  shouldCancel?: () => boolean | Promise<boolean>;
};

async function pushOneCollection(
  auth: ShopAuth,
  collection: ParsedCollection,
  resolver: DestinationResolver
): Promise<CollectionPushOutcome> {
  const collectionId = toCollectionGid(collection.id);
  const label = collection.title ?? collection.id;

  // 1. Field update — only the fields the CSV carried.
  const input: Record<string, unknown> = { id: collectionId };
  let fieldCount = 0;
  if (collection.title !== undefined) {
    input.title = collection.title;
    fieldCount++;
  }
  if (collection.bodyHtml !== undefined) {
    input.descriptionHtml = collection.bodyHtml;
    fieldCount++;
  }
  if (collection.handle !== undefined) {
    input.handle = collection.handle;
    fieldCount++;
  }
  if (collection.sortOrder !== undefined) {
    input.sortOrder = collection.sortOrder.toUpperCase();
    fieldCount++;
  }
  if (collection.templateSuffix !== undefined) {
    input.templateSuffix = collection.templateSuffix;
    fieldCount++;
  }

  // SEO: merge with current values so we never blank the side the CSV omitted.
  if (collection.seoTitle !== undefined || collection.seoDescription !== undefined) {
    let currentTitle = "";
    let currentDesc = "";
    try {
      type SeoResp = {
        data?: { collection?: { seo?: { title: string | null; description: string | null } | null } | null };
      };
      const resp = await shopifyGraphQLRequest<SeoResp>({
        shopDomain: auth.shopDomain,
        accessToken: auth.accessToken,
        query: COLLECTION_SEO_QUERY,
        variables: { id: collectionId }
      });
      currentTitle = resp.data?.collection?.seo?.title ?? "";
      currentDesc = resp.data?.collection?.seo?.description ?? "";
    } catch {
      // If the snapshot read fails, fall back to only the provided side.
    }
    input.seo = {
      title: collection.seoTitle !== undefined ? collection.seoTitle : currentTitle,
      description: collection.seoDescription !== undefined ? collection.seoDescription : currentDesc
    };
    fieldCount++;
  }

  if (fieldCount > 0) {
    type Resp = {
      data?: { collectionUpdate?: { userErrors?: Array<{ field: string[] | null; message: string }> } };
      errors?: Array<{ message: string }>;
    };
    const resp = await shopifyGraphQLRequest<Resp>({
      shopDomain: auth.shopDomain,
      accessToken: auth.accessToken,
      query: COLLECTION_UPDATE,
      variables: { input }
    });
    const issues = [
      ...(resp.errors?.map((e) => e.message) ?? []),
      ...(resp.data?.collectionUpdate?.userErrors?.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`) ?? [])
    ];
    if (issues.length > 0) {
      return { id: collection.id, title: label, ok: false, message: `collectionUpdate: ${issues.join("; ")}` };
    }
  }

  // 2. Metafields via metafieldsSet (cap 25 per call).
  let metafieldsSet = 0;
  const mfInputs: Array<Record<string, unknown>> = [];
  for (const mf of collection.metafields) {
    let value = mf.value;
    if (isReferenceType(mf.type) && mf.ref) {
      const resolved = await resolver.resolveValue(mf.value, mf.type, mf.ref);
      if (!resolved) continue; // can't resolve in destination — skip rather than write a broken GID
      value = resolved;
    }
    mfInputs.push({ ownerId: collectionId, namespace: mf.namespace, key: mf.key, type: mf.type, value });
  }
  if (mfInputs.length > 0) {
    type Resp = {
      data?: { metafieldsSet?: { userErrors?: Array<{ field: string[] | null; message: string }> } };
      errors?: Array<{ message: string }>;
    };
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

  return {
    id: collection.id,
    title: label,
    ok: true,
    message: `Updated ${label}: ${fieldCount} field(s), ${metafieldsSet} metafield(s)`
  };
}

export async function pushParsedCollections(
  storeId: bigint,
  collections: ParsedCollection[],
  options: CollectionPushOptions = {}
): Promise<{
  outcomes: CollectionPushOutcome[];
  totals: { ok: number; failed: number; cancelled?: boolean };
}> {
  const auth = await loadShopAuth(storeId);
  if (!auth) {
    return {
      outcomes: collections.map((c) => ({
        id: c.id,
        title: c.title ?? c.id,
        ok: false,
        message: "Store not connected"
      })),
      totals: { ok: 0, failed: collections.length }
    };
  }

  const resolver = new DestinationResolver(auth);
  const outcomes: CollectionPushOutcome[] = [];
  let ok = 0;
  let failed = 0;
  let cancelled = false;

  for (let i = 0; i < collections.length; i++) {
    if (options.shouldCancel && (await options.shouldCancel())) {
      cancelled = true;
      break;
    }
    const collection = collections[i];
    let outcome: CollectionPushOutcome;
    try {
      outcome = await pushOneCollection(auth, collection, resolver);
    } catch (error) {
      outcome = {
        id: collection.id,
        title: collection.title ?? collection.id,
        ok: false,
        message: error instanceof Error ? error.message : "Unknown error"
      };
    }
    outcomes.push(outcome);
    if (outcome.ok) ok += 1;
    else failed += 1;
    try {
      await options.onProgress?.({ index: i, total: collections.length, ok, failed, outcome });
    } catch {
      // never let progress reporting break the push
    }
  }

  return { outcomes, totals: { ok, failed, cancelled } };
}
