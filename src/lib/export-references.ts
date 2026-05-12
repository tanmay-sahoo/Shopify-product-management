// Resolves Shopify reference-type metafield values (GIDs) to human-readable labels.
//
// Reference-type metafields like metaobject_reference / product_reference store
// values as either:
//   "gid://shopify/Metaobject/123"
//   ["gid://shopify/Metaobject/123", "gid://shopify/Product/456"]
//
// This module fetches each GID via the GraphQL `nodes(ids:)` query and returns
// a map of gid -> display string (title, handle, image URL, etc.).

import { shopifyGraphQLRequest } from "@/lib/shopify";

const REF_TYPE = /^(list\.)?(metaobject|product|variant|collection|file|page)_reference$/;

export function isReferenceType(type: string): boolean {
  return REF_TYPE.test(type);
}

export function isListReferenceType(type: string): boolean {
  return type.startsWith("list.") && REF_TYPE.test(type);
}

export function extractGidsFromValue(value: string | null): string[] {
  if (!value) return [];
  if (value.startsWith("[")) {
    try {
      const arr = JSON.parse(value);
      return Array.isArray(arr)
        ? arr.filter((v): v is string => typeof v === "string" && v.startsWith("gid://"))
        : [];
    } catch {
      return [];
    }
  }
  if (value.startsWith("gid://")) return [value];
  return [];
}

const NODES_QUERY = `
  query Nodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      id
      __typename
      ... on Metaobject { displayName handle type }
      ... on Product { title handle }
      ... on ProductVariant { title sku product { title handle } }
      ... on Collection { title handle }
      ... on MediaImage { image { url } alt }
      ... on GenericFile { url }
      ... on Video { sources { url } }
      ... on Page { title handle }
    }
  }
`;

type ResolvedNode = {
  id: string;
  __typename: string;
  displayName?: string | null;
  handle?: string | null;
  type?: string | null;
  title?: string | null;
  sku?: string | null;
  product?: { title: string | null; handle: string | null } | null;
  image?: { url: string | null } | null;
  alt?: string | null;
  url?: string | null;
  sources?: Array<{ url: string | null }> | null;
};

// Portable key encodes enough info to look up the same logical object on
// a different shop. Format: `<kind>:<identifier>` or `<kind>:<a>:<b>`.
function portableKeyForNode(node: ResolvedNode): string | null {
  switch (node.__typename) {
    case "Metaobject":
      if (!node.type || !node.handle) return null;
      return `metaobject:${node.type}:${node.handle}`;
    case "Product":
      return node.handle ? `product:${node.handle}` : null;
    case "ProductVariant":
      if (!node.product?.handle) return null;
      return `variant:${node.product.handle}:${node.sku ?? ""}`;
    case "Collection":
      return node.handle ? `collection:${node.handle}` : null;
    case "MediaImage":
      return node.image?.url ? `file:${node.image.url}` : null;
    case "GenericFile":
      return node.url ? `file:${node.url}` : null;
    case "Video":
      return node.sources?.[0]?.url ? `file:${node.sources[0].url}` : null;
    case "Page":
      return node.handle ? `page:${node.handle}` : null;
    default:
      return null;
  }
}

function labelForNode(node: ResolvedNode): string | null {
  switch (node.__typename) {
    case "Metaobject":
      return node.displayName ?? node.handle ?? null;
    case "Product":
      return node.title ?? null;
    case "ProductVariant":
      return (
        [node.product?.title, node.title].filter(Boolean).join(" — ") || node.sku || null
      );
    case "Collection":
      return node.title ?? null;
    case "MediaImage":
      return node.image?.url ?? node.alt ?? null;
    case "GenericFile":
      return node.url ?? null;
    case "Video":
      return node.sources?.[0]?.url ?? null;
    case "Page":
      return node.title ?? null;
    default:
      return null;
  }
}

export type ResolvedReferences = {
  displays: Map<string, string>;
  portables: Map<string, string>;
};

export async function resolveGidsRich(
  shopDomain: string,
  accessToken: string,
  gids: string[]
): Promise<ResolvedReferences> {
  const displays = new Map<string, string>();
  const portables = new Map<string, string>();
  if (gids.length === 0) return { displays, portables };

  const unique = Array.from(new Set(gids));
  for (let i = 0; i < unique.length; i += 250) {
    const slice = unique.slice(i, i + 250);
    type Resp = {
      data?: { nodes: Array<ResolvedNode | null> };
      errors?: Array<{ message: string }>;
    };
    try {
      const resp = await shopifyGraphQLRequest<Resp>({
        shopDomain,
        accessToken,
        query: NODES_QUERY,
        variables: { ids: slice }
      });
      if (resp.errors?.length) continue;
      for (const node of resp.data?.nodes ?? []) {
        if (!node) continue;
        const label = labelForNode(node);
        if (label) displays.set(node.id, label);
        const portable = portableKeyForNode(node);
        if (portable) portables.set(node.id, portable);
      }
    } catch {
      // best-effort
    }
  }
  return { displays, portables };
}

// Back-compat wrapper kept for older callers.
export async function resolveGids(
  shopDomain: string,
  accessToken: string,
  gids: string[]
): Promise<Map<string, string>> {
  const { displays } = await resolveGidsRich(shopDomain, accessToken, gids);
  return displays;
}

export function resolveMetafieldValue(
  rawValue: string | null,
  type: string,
  lookup: Map<string, string>
): string {
  if (!rawValue || !isReferenceType(type)) return rawValue ?? "";
  if (isListReferenceType(type)) {
    try {
      const arr = JSON.parse(rawValue);
      if (Array.isArray(arr)) {
        return arr
          .map((gid: unknown) => (typeof gid === "string" ? (lookup.get(gid) ?? gid) : ""))
          .filter(Boolean)
          .join(", ");
      }
    } catch {
      // fall through
    }
    return rawValue;
  }
  return lookup.get(rawValue) ?? rawValue;
}
