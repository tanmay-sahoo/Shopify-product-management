// Pushes parsed collection rows into Shopify as partial updates. For each row:
//  - collectionUpdate with only the fields the CSV carried (never products, so
//    manual-collection membership is never touched)
//  - ruleSet when the CSV carried "Rules" — note Shopify cannot convert a
//    collection between manual and smart, so rules only apply on create or to
//    a collection that is already smart
//  - metafieldsSet for any collection metafields
//
// Matching is update-first, create-as-fallback: a row goes to the collection
// its ID points at, else to the one with its Handle, and is created when
// neither exists. Best-effort, per-row — errors are reported back so a partial
// run still produces output.

import {
  isMetafieldRuleColumn,
  metafieldRuleOwnerType,
  type CollectionRule
} from "@/lib/collection-rules";
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

// Current state we need before an update: SEO (merged so we never blank the
// side the CSV omitted) and whether the collection is already smart (rules can
// only be written to a collection that has them).
const COLLECTION_CURRENT_QUERY = `
  query CollectionCurrent($id: ID!) {
    collection(id: $id) {
      id
      seo { title description }
      ruleSet { appliedDisjunctively rules { column } }
    }
  }
`;

type CurrentCollection = {
  seoTitle: string;
  seoDescription: string;
  // A collection is smart when it has rules; only those accept a new rule set.
  smart: boolean;
};

/**
 * Reads the collection behind a GID. Returns null only when Shopify says it
 * does not exist, and throws when the lookup itself fails — a transport error
 * must never be mistaken for "missing", or the row would create a duplicate.
 */
async function loadCurrentCollection(auth: ShopAuth, gid: string): Promise<CurrentCollection | null> {
  type Resp = {
    data?: {
      collection?: {
        seo?: { title: string | null; description: string | null } | null;
        ruleSet?: { rules?: Array<{ column: string }> } | null;
      } | null;
    };
    errors?: Array<{ message: string }>;
  };
  const resp = await shopifyGraphQLRequest<Resp>({
    shopDomain: auth.shopDomain,
    accessToken: auth.accessToken,
    query: COLLECTION_CURRENT_QUERY,
    variables: { id: gid }
  });
  if (resp.errors && resp.errors.length > 0) {
    throw new Error(resp.errors.map((e) => e.message).join("; "));
  }
  const node = resp.data?.collection;
  if (!node) return null;
  return {
    seoTitle: node.seo?.title ?? "",
    seoDescription: node.seo?.description ?? "",
    smart: Array.isArray(node.ruleSet?.rules) && (node.ruleSet?.rules?.length ?? 0) > 0
  };
}

const METAFIELD_DEFINITION_LOOKUP = `
  query RuleMetafieldDefinition($namespace: String!, $key: String!, $ownerType: MetafieldOwnerType!) {
    metafieldDefinitions(first: 1, namespace: $namespace, key: $key, ownerType: $ownerType) {
      edges { node { id } }
    }
  }
`;

// Metafield-definition rules reference a definition by ID, which differs per
// shop, so the CSV carries `namespace.key` and we resolve it here. Cached for
// the whole push run (one lookup per definition, not per collection).
class RuleDefinitionResolver {
  private readonly cache = new Map<string, string | null>();

  constructor(private readonly auth: ShopAuth) {}

  async resolve(definitionKey: string, ownerType: "PRODUCT" | "PRODUCTVARIANT"): Promise<string | null> {
    const cacheKey = `${ownerType}:${definitionKey}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const dot = definitionKey.indexOf(".");
    const namespace = definitionKey.slice(0, dot);
    const key = definitionKey.slice(dot + 1);

    let id: string | null = null;
    try {
      type Resp = {
        data?: { metafieldDefinitions?: { edges?: Array<{ node: { id: string } }> } };
      };
      const resp = await shopifyGraphQLRequest<Resp>({
        shopDomain: this.auth.shopDomain,
        accessToken: this.auth.accessToken,
        query: METAFIELD_DEFINITION_LOOKUP,
        variables: { namespace, key, ownerType }
      });
      id = resp.data?.metafieldDefinitions?.edges?.[0]?.node?.id ?? null;
    } catch {
      id = null;
    }
    this.cache.set(cacheKey, id);
    return id;
  }
}

/**
 * Turns parsed rules into CollectionRuleSetInput. Returns the unresolved
 * definition keys separately so the caller can report them instead of writing
 * a rule set that silently drops a condition.
 */
async function buildRuleSetInput(
  rules: CollectionRule[],
  appliedDisjunctively: boolean,
  definitions: RuleDefinitionResolver
): Promise<{ input: Record<string, unknown> | null; unresolved: string[] }> {
  const unresolved: string[] = [];
  const ruleInputs: Array<Record<string, unknown>> = [];

  for (const rule of rules) {
    const ruleInput: Record<string, unknown> = {
      column: rule.column,
      relation: rule.relation,
      condition: rule.condition
    };
    if (isMetafieldRuleColumn(rule.column) && rule.definitionKey) {
      const id = await definitions.resolve(rule.definitionKey, metafieldRuleOwnerType(rule.column));
      if (!id) {
        unresolved.push(rule.definitionKey);
        continue;
      }
      ruleInput.conditionObjectId = id;
    }
    ruleInputs.push(ruleInput);
  }

  if (unresolved.length > 0 || ruleInputs.length === 0) return { input: null, unresolved };
  return { input: { appliedDisjunctively, rules: ruleInputs }, unresolved };
}

const COLLECTION_UPDATE = `
  mutation CollectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection { id }
      userErrors { field message }
    }
  }
`;

const COLLECTION_CREATE = `
  mutation CollectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection { id }
      userErrors { field message }
    }
  }
`;

const FIND_COLLECTION_BY_HANDLE = `
  query FindCollectionByHandle($q: String!) {
    collections(first: 1, query: $q) {
      edges { node { id handle } }
    }
  }
`;

async function findCollectionIdByHandle(auth: ShopAuth, handle: string): Promise<string | null> {
  type Resp = {
    data?: { collections?: { edges?: Array<{ node: { id: string; handle: string } }> } };
    errors?: Array<{ message: string }>;
  };
  const resp = await shopifyGraphQLRequest<Resp>({
    shopDomain: auth.shopDomain,
    accessToken: auth.accessToken,
    query: FIND_COLLECTION_BY_HANDLE,
    variables: { q: `handle:${handle}` }
  });
  const edge = resp.data?.collections?.edges?.[0];
  // Guard against a fuzzy match — require the handle to match exactly.
  if (edge && edge.node.handle === handle) return edge.node.id;
  return null;
}

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
  // Non-fatal note shown on successful rows (e.g. metafields skipped/failed).
  warning?: string;
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
  resolver: DestinationResolver,
  definitions: RuleDefinitionResolver
): Promise<CollectionPushOutcome> {
  const label = collection.title ?? collection.handle ?? collection.id;
  // Non-fatal notes about the rule set (not applied / definition missing).
  const ruleNotes: string[] = [];

  // Resolve the target collection, update-first and create as a fallback:
  //  - ID present and the collection still exists → update it.
  //  - otherwise match on Handle → update that one.
  //  - neither matches → create (cross-shop restore, or a collection that was
  //    deleted in the shop since the CSV was exported).
  // The current state is read once here and reused by the update below.
  let collectionId = "";
  let isCreate = false;
  let current: CurrentCollection | null = null;
  let staleId = false;

  if (collection.id) {
    const gid = toCollectionGid(collection.id);
    current = await loadCurrentCollection(auth, gid);
    if (current) collectionId = gid;
    else staleId = true;
  }

  if (!collectionId && collection.handle) {
    const found = await findCollectionIdByHandle(auth, collection.handle);
    if (found) {
      collectionId = found;
      current = await loadCurrentCollection(auth, found);
    } else {
      isCreate = true;
    }
  }

  if (!collectionId && !isCreate) {
    return {
      id: collection.id,
      title: label,
      ok: false,
      message: staleId
        ? `Collection ${collection.id} no longer exists in this shop, and the row has no Handle to match or create by`
        : "No ID or Handle to match the collection"
    };
  }

  // Say so when the CSV's ID was stale — the row still lands, but on a
  // different collection than the ID named, or on a brand new one.
  if (staleId) {
    ruleNotes.push(
      isCreate
        ? `ID ${collection.id} no longer exists in this shop — created a new collection instead`
        : `ID ${collection.id} no longer exists in this shop — matched "${collection.handle}" by handle instead`
    );
  }

  // 1. Create or update the collection's scalar fields.
  let action: "Created" | "Updated" = "Updated";
  let fieldCount = 0;

  if (isCreate) {
    // Shopify requires a title to create a collection.
    if (!collection.title) {
      return {
        id: collection.id,
        title: label,
        ok: false,
        message: `Title is required to create collection "${collection.handle}" in this shop`
      };
    }
    const createInput: Record<string, unknown> = { title: collection.title };
    if (collection.handle !== undefined) createInput.handle = collection.handle;
    if (collection.bodyHtml !== undefined) createInput.descriptionHtml = collection.bodyHtml;
    if (collection.sortOrder !== undefined) createInput.sortOrder = collection.sortOrder.toUpperCase();
    if (collection.templateSuffix !== undefined) createInput.templateSuffix = collection.templateSuffix;
    if (collection.seoTitle !== undefined || collection.seoDescription !== undefined) {
      createInput.seo = { title: collection.seoTitle ?? "", description: collection.seoDescription ?? "" };
    }
    if (collection.imageSrc) {
      createInput.image = { src: collection.imageSrc, altText: collection.imageAlt ?? "" };
    }
    // Rules can only be set at create time (Shopify never converts a
    // collection between manual and smart afterwards), so this is the one
    // chance to make the restored collection smart.
    if (collection.rules && collection.rules.length > 0) {
      const { input: ruleSet, unresolved } = await buildRuleSetInput(
        collection.rules,
        collection.rulesAppliedDisjunctively ?? false,
        definitions
      );
      if (ruleSet) {
        createInput.ruleSet = ruleSet;
      } else if (unresolved.length > 0) {
        ruleNotes.push(
          `rules not applied — no metafield definition for ${unresolved.join(", ")} in this shop`
        );
      }
    }

    type Resp = {
      data?: { collectionCreate?: { collection?: { id: string } | null; userErrors?: Array<{ field: string[] | null; message: string }> } };
      errors?: Array<{ message: string }>;
    };
    const resp = await shopifyGraphQLRequest<Resp>({
      shopDomain: auth.shopDomain,
      accessToken: auth.accessToken,
      query: COLLECTION_CREATE,
      variables: { input: createInput }
    });
    const issues = [
      ...(resp.errors?.map((e) => e.message) ?? []),
      ...(resp.data?.collectionCreate?.userErrors?.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`) ?? [])
    ];
    if (issues.length > 0) {
      return { id: collection.id, title: label, ok: false, message: `collectionCreate: ${issues.join("; ")}` };
    }
    const newId = resp.data?.collectionCreate?.collection?.id;
    if (!newId) {
      return { id: collection.id, title: label, ok: false, message: "collectionCreate returned no id" };
    }
    collectionId = newId;
    action = "Created";
    fieldCount = Object.keys(createInput).length;
  } else {
    // Update — only the fields the CSV carried.
    const input: Record<string, unknown> = { id: collectionId };
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

    // Current state was read during target resolution — no second round-trip.
    const needsSeo = collection.seoTitle !== undefined || collection.seoDescription !== undefined;
    const wantsRules = Boolean(collection.rules && collection.rules.length > 0);
    const currentSeoTitle = current?.seoTitle ?? "";
    const currentSeoDesc = current?.seoDescription ?? "";
    const currentlySmart: boolean | null = current ? current.smart : null;

    // SEO: merge with current values so we never blank the side the CSV omitted.
    if (needsSeo) {
      input.seo = {
        title: collection.seoTitle !== undefined ? collection.seoTitle : currentSeoTitle,
        description: collection.seoDescription !== undefined ? collection.seoDescription : currentSeoDesc
      };
      fieldCount++;
    }

    // Rules: only writable on a collection that is already smart. Sending a
    // ruleSet to a manual collection is rejected by Shopify, so report it as a
    // warning instead of failing the whole row.
    if (wantsRules && collection.rules) {
      if (currentlySmart === false) {
        ruleNotes.push("rules not applied — this collection is manual and Shopify can't convert it to smart");
      } else if (currentlySmart === null) {
        ruleNotes.push("rules not applied — couldn't read the collection's current rules");
      } else {
        const { input: ruleSet, unresolved } = await buildRuleSetInput(
          collection.rules,
          collection.rulesAppliedDisjunctively ?? false,
          definitions
        );
        if (ruleSet) {
          input.ruleSet = ruleSet;
          fieldCount++;
        } else if (unresolved.length > 0) {
          ruleNotes.push(`rules not applied — no metafield definition for ${unresolved.join(", ")} in this shop`);
        }
      }
    }

    if (collection.imageSrc) {
      input.image = { src: collection.imageSrc, altText: collection.imageAlt ?? "" };
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
  }

  // 2. Metafields via metafieldsSet (cap 25 per call). We track set / skipped /
  //    failed so the import result can explain why a metafield didn't land
  //    (most often an unresolvable cross-shop reference, or a write rejection).
  let metafieldsSet = 0;
  let metafieldsSkipped = 0;
  let metafieldsFailed = 0;
  const failMessages: string[] = [];
  const mfInputs: Array<Record<string, unknown>> = [];
  for (const mf of collection.metafields) {
    let value = mf.value;
    if (isReferenceType(mf.type) && mf.ref) {
      const resolved = await resolver.resolveValue(mf.value, mf.type, mf.ref);
      if (!resolved) {
        // Referenced resource doesn't exist in the destination shop — skip
        // rather than write a broken GID.
        metafieldsSkipped++;
        continue;
      }
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
      const errs = [
        ...(resp.errors?.map((e) => e.message) ?? []),
        ...(resp.data?.metafieldsSet?.userErrors?.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`) ?? [])
      ];
      if (errs.length === 0) {
        metafieldsSet += slice.length;
      } else {
        metafieldsFailed += slice.length;
        for (const e of errs) if (!failMessages.includes(e)) failMessages.push(e);
      }
    }
  }

  // Build a message that surfaces what happened to the metafields, plus a
  // non-fatal warning (skipped/failed) shown on the successful row.
  const mfNotes: string[] = [`${metafieldsSet} metafield(s)`];
  const warningParts: string[] = [...ruleNotes];
  if (metafieldsSkipped > 0) {
    mfNotes.push(`${metafieldsSkipped} skipped (unresolved reference)`);
    warningParts.push(`${metafieldsSkipped} metafield(s) skipped (unresolved reference)`);
  }
  if (metafieldsFailed > 0) {
    const detail = failMessages.length ? `: ${failMessages.slice(0, 2).join("; ")}` : "";
    mfNotes.push(`${metafieldsFailed} failed${detail}`);
    warningParts.push(`${metafieldsFailed} metafield(s) failed${detail}`);
  }

  return {
    id: collection.id,
    title: label,
    ok: true,
    message: `${action} ${label}: ${fieldCount} field(s), ${mfNotes.join(", ")}`,
    warning: warningParts.length > 0 ? warningParts.join("; ") : undefined
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
  const definitions = new RuleDefinitionResolver(auth);
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
      outcome = await pushOneCollection(auth, collection, resolver, definitions);
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
