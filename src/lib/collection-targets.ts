// Resolves the collection handles a product CSV lists into collections the
// product can actually be added to, creating the missing ones.
//
// Two things make this more than a lookup:
//
//  - Smart collections reject collectionAddProducts: their membership comes
//    from their rules, so a manual add is not just an error, it's meaningless.
//    A store whose taxonomy is tag-driven (every collection smart) would
//    otherwise produce one failure per collection per row — noise that buries
//    real problems.
//  - A created collection must be reused by the following rows, so both the
//    lookup and the smart/manual answer are cached for the whole run.
//
// Created collections are manual. A smart one needs rules, which a product CSV
// has no room for, so those belong in the collections import.

import { shopifyGraphQLRequest } from "@/lib/shopify";

const COLLECTION_BY_HANDLE = `
  query CollectionByHandle($q: String!) {
    collections(first: 1, query: $q) {
      edges { node { id handle ruleSet { rules { column } } } }
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

export type CollectionTarget = {
  id: string;
  /** Rule-based: membership can't be set by adding the product. */
  smart: boolean;
  /** True when this run created it. */
  created: boolean;
};

/**
 * "brother-fax" → "Brother Fax". The CSV carries only handles but
 * collectionCreate requires a title, so one is derived. Exported for tests and
 * so callers can report what title a created collection got.
 */
export function titleFromHandle(handle: string): string {
  const words = handle
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(" ") : handle;
}

export class CollectionTargets {
  private cache = new Map<string, CollectionTarget | null>();

  constructor(private readonly auth: { shopDomain: string; accessToken: string }) {}

  /** Collections this run created, as handle → title, for reporting. */
  readonly created = new Map<string, string>();

  /**
   * Finds the collection with this handle, creating it as a manual collection
   * when the shop has none. Returns null when it neither exists nor could be
   * created; `error` then says why.
   */
  async resolveOrCreate(handle: string): Promise<{ target: CollectionTarget | null; error?: string }> {
    const cached = this.cache.get(handle);
    if (cached !== undefined) return { target: cached };

    const existing = await this.find(handle);
    if (existing) {
      this.cache.set(handle, existing);
      return { target: existing };
    }

    const created = await this.create(handle);
    if (!created.id) {
      // Not cached: a failure here is usually transient (throttle), and the
      // next row deserves a fresh attempt.
      return { target: null, error: created.error };
    }
    const target: CollectionTarget = { id: created.id, smart: false, created: true };
    this.cache.set(handle, target);
    this.created.set(handle, titleFromHandle(handle));
    return { target };
  }

  private async find(handle: string): Promise<CollectionTarget | null> {
    type Resp = {
      data?: {
        collections?: {
          edges?: Array<{ node: { id: string; handle: string; ruleSet?: { rules?: Array<{ column: string }> } | null } }>;
        };
      };
    };
    const resp = await shopifyGraphQLRequest<Resp>({
      shopDomain: this.auth.shopDomain,
      accessToken: this.auth.accessToken,
      query: COLLECTION_BY_HANDLE,
      variables: { q: `handle:${handle}` }
    });
    const node = resp.data?.collections?.edges?.[0]?.node;
    // The query is a search, so guard against a fuzzy match.
    if (!node || node.handle !== handle) return null;
    return {
      id: node.id,
      smart: Array.isArray(node.ruleSet?.rules) && (node.ruleSet?.rules?.length ?? 0) > 0,
      created: false
    };
  }

  private async create(handle: string): Promise<{ id: string | null; error?: string }> {
    type Resp = {
      data?: {
        collectionCreate?: {
          collection?: { id: string } | null;
          userErrors?: Array<{ field: string[] | null; message: string }>;
        };
      };
      errors?: Array<{ message: string }>;
    };
    try {
      const resp = await shopifyGraphQLRequest<Resp>({
        shopDomain: this.auth.shopDomain,
        accessToken: this.auth.accessToken,
        query: COLLECTION_CREATE,
        variables: { input: { handle, title: titleFromHandle(handle) } }
      });
      const issues = [
        ...(resp.errors?.map((e) => e.message) ?? []),
        ...(resp.data?.collectionCreate?.userErrors?.map((e) => e.message) ?? [])
      ];
      const id = resp.data?.collectionCreate?.collection?.id ?? null;
      if (!id) return { id: null, error: issues[0] ?? "collectionCreate returned no id" };
      return { id };
    } catch (error) {
      return { id: null, error: error instanceof Error ? error.message : "unknown error" };
    }
  }
}
