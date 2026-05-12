// Resolves portable metafield reference keys (emitted by export) into
// destination-store GIDs. Used by the bulk-import push pipeline so that
// metaobject / product / variant / collection references survive a
// migration between Shopify stores.
//
// Portable key formats produced by export:
//   metaobject:<type>:<handle>
//   product:<handle>
//   variant:<productHandle>:<sku>
//   collection:<handle>
//   file:<originalUrl>
//   page:<handle>

import { shopifyGraphQLRequest } from "@/lib/shopify";

const METAOBJECT_BY_HANDLE = `
  query MetaobjectByHandle($handle: MetaobjectHandleInput!) {
    metaobjectByHandle(handle: $handle) { id }
  }
`;

const PRODUCT_BY_HANDLE = `
  query FindProduct($q: String!) {
    products(first: 1, query: $q) { edges { node { id handle variants(first: 100) { edges { node { id sku } } } } } }
  }
`;

const COLLECTION_BY_HANDLE = `
  query FindCollection($q: String!) {
    collections(first: 1, query: $q) { edges { node { id handle } } }
  }
`;

type Auth = { shopDomain: string; accessToken: string };

export class DestinationResolver {
  private cache = new Map<string, string | null>();

  constructor(private auth: Auth) {}

  async resolve(portable: string): Promise<string | null> {
    if (!portable) return null;
    if (this.cache.has(portable)) return this.cache.get(portable) ?? null;

    const parts = portable.split(":");
    const kind = parts[0];
    let gid: string | null = null;

    try {
      if (kind === "metaobject" && parts.length >= 3) {
        const type = parts[1];
        const handle = parts.slice(2).join(":");
        type Resp = { data?: { metaobjectByHandle?: { id: string } | null }; errors?: Array<{ message: string }> };
        const resp = await shopifyGraphQLRequest<Resp>({
          shopDomain: this.auth.shopDomain,
          accessToken: this.auth.accessToken,
          query: METAOBJECT_BY_HANDLE,
          variables: { handle: { type, handle } }
        });
        gid = resp.data?.metaobjectByHandle?.id ?? null;
      } else if (kind === "product" && parts.length >= 2) {
        const handle = parts.slice(1).join(":");
        type Resp = { data?: { products?: { edges?: Array<{ node: { id: string } }> } } };
        const resp = await shopifyGraphQLRequest<Resp>({
          shopDomain: this.auth.shopDomain,
          accessToken: this.auth.accessToken,
          query: PRODUCT_BY_HANDLE,
          variables: { q: `handle:${handle}` }
        });
        gid = resp.data?.products?.edges?.[0]?.node.id ?? null;
      } else if (kind === "variant" && parts.length >= 3) {
        const productHandle = parts[1];
        const sku = parts.slice(2).join(":");
        type Resp = {
          data?: {
            products?: {
              edges?: Array<{
                node: { id: string; variants: { edges: Array<{ node: { id: string; sku: string | null } }> } };
              }>;
            };
          };
        };
        const resp = await shopifyGraphQLRequest<Resp>({
          shopDomain: this.auth.shopDomain,
          accessToken: this.auth.accessToken,
          query: PRODUCT_BY_HANDLE,
          variables: { q: `handle:${productHandle}` }
        });
        const variants = resp.data?.products?.edges?.[0]?.node.variants.edges ?? [];
        gid = (sku ? variants.find((v) => v.node.sku === sku) : variants[0])?.node.id ?? null;
      } else if (kind === "collection" && parts.length >= 2) {
        const handle = parts.slice(1).join(":");
        type Resp = { data?: { collections?: { edges?: Array<{ node: { id: string } }> } } };
        const resp = await shopifyGraphQLRequest<Resp>({
          shopDomain: this.auth.shopDomain,
          accessToken: this.auth.accessToken,
          query: COLLECTION_BY_HANDLE,
          variables: { q: `handle:${handle}` }
        });
        gid = resp.data?.collections?.edges?.[0]?.node.id ?? null;
      }
      // file / page resolution intentionally not supported in this MVP;
      // returns null and the metafield write is skipped.
    } catch {
      gid = null;
    }

    this.cache.set(portable, gid);
    return gid;
  }

  async resolveValue(rawValue: string, type: string, ref: string | undefined): Promise<string | null> {
    if (!ref) return null;
    if (type.startsWith("list.")) {
      // Ref column stores JSON array of portable keys.
      let portables: string[] = [];
      try {
        const parsed = JSON.parse(ref);
        if (Array.isArray(parsed)) portables = parsed.filter((x): x is string => typeof x === "string");
      } catch {
        return null;
      }
      const gids: string[] = [];
      for (const p of portables) {
        const gid = await this.resolve(p);
        if (gid) gids.push(gid);
      }
      if (gids.length === 0) return null;
      return JSON.stringify(gids);
    }
    return this.resolve(ref);
  }
}
