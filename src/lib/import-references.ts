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

// Look up a metafield definition in the destination shop to learn its real
// type and, for metaobject references, which metaobject definition it targets.
const METAFIELD_DEFINITION = `
  query MetafieldDef($ownerType: MetafieldOwnerType!, $namespace: String!, $key: String!) {
    metafieldDefinitions(first: 1, ownerType: $ownerType, namespace: $namespace, key: $key) {
      edges { node { type { name } validations { name value } } }
    }
  }
`;

const METAOBJECT_DEFINITION = `
  query MetaobjectDef($id: ID!) {
    metaobjectDefinition(id: $id) {
      type
      fieldDefinitions { key name required type { name } }
    }
  }
`;

const METAOBJECTS_BY_TYPE = `
  query MetaobjectsByType($type: String!, $after: String) {
    metaobjects(type: $type, first: 250, after: $after) {
      edges { node { id handle displayName fields { key value } } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const METAOBJECT_CREATE = `
  mutation MetaobjectCreate($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject { id displayName }
      userErrors { field message code }
    }
  }
`;

// Enumerate the global Color/Pattern taxonomy values (id + name) via a category
// known to carry them (apparel). The values are global and stable across shops,
// so any such category yields the full base-color and pattern lists.
const TAXONOMY_ATTR_VALUES = `
  query TaxonomyAttrValues($search: String!) {
    taxonomy {
      categories(first: 5, search: $search) {
        edges {
          node {
            attributes(first: 50) {
              edges {
                node {
                  ... on TaxonomyChoiceListAttribute {
                    name
                    values(first: 250) { edges { node { id name } } }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Field keys we treat as a metaobject's "label" when creating one from a bare
// display string. Falls back to the first text field, then the first field.
const DISPLAY_FIELD_KEYS = new Set(["label", "name", "title", "value"]);

export type MetaobjectOwnerType = "PRODUCT" | "PRODUCTVARIANT" | "COLLECTION";

type MetaobjectFieldDef = { key: string; type: string; required: boolean };

type MetafieldDefInfo = {
  type: string; // e.g. "list.metaobject_reference"
  metaobjectType: string | null; // target metaobject definition type, e.g. "shopify--color-pattern"
  displayFieldKey: string | null; // field to set when creating a metaobject
  fields: MetaobjectFieldDef[]; // all field definitions (to satisfy required fields on create)
};

// Canonical form for matching color/label strings across shops: lowercase,
// expand German umlauts (ß→ss, ä→ae, …), strip remaining diacritics, and drop
// non-alphanumerics. So "Weiß" ≈ "weiss", "Crème" ≈ "Creme", "Grün" ≈ "gruen".
function canonicalLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

// Color name → hex, keyed by canonicalLabel, so a required color/swatch field
// can be filled when creating a metaobject from just a name. Covers common
// German and English names; "mixed"/multi map to a neutral gray so creation
// still succeeds (flagged in a note).
const COLOR_HEX: Record<string, string> = {
  schwarz: "#000000", black: "#000000",
  weiss: "#FFFFFF", white: "#FFFFFF",
  grau: "#808080", grey: "#808080", gray: "#808080",
  rot: "#FF0000", red: "#FF0000",
  blau: "#0000FF", blue: "#0000FF",
  gruen: "#008000", green: "#008000",
  gelb: "#FFFF00", yellow: "#FFFF00",
  orange: "#FFA500",
  lila: "#800080", violett: "#800080", purple: "#800080", violet: "#800080",
  rosa: "#FFC0CB", pink: "#FFC0CB",
  braun: "#8B4513", brown: "#8B4513",
  beige: "#F5F5DC",
  creme: "#FFFDD0", cream: "#FFFDD0",
  gold: "#FFD700",
  silber: "#C0C0C0", silver: "#C0C0C0",
  tuerkis: "#40E0D0", turquoise: "#40E0D0",
  marine: "#000080", navy: "#000080",
  bordeaux: "#7B1F2B", weinrot: "#7B1F2B",
  natur: "#E5D3B3", naturel: "#E5D3B3",
  gemischt: "#808080", mixed: "#808080", mehrfarbig: "#808080", bunt: "#808080", multi: "#808080"
};

const NEUTRAL_HEX = new Set(["gemischt", "mixed", "mehrfarbig", "bunt", "multi"]);

// Bidirectional color-name synonyms (canonical form) so a German label can match
// an existing English standard metaobject and vice-versa. Standard color-pattern
// metaobjects are often stored under English/base names even in a German shop.
const COLOR_SYNONYM_GROUPS: string[][] = [
  ["weiss", "white"],
  ["schwarz", "black"],
  ["rot", "red"],
  ["blau", "blue"],
  ["gruen", "green"],
  ["gelb", "yellow"],
  ["grau", "gray", "grey"],
  ["braun", "brown"],
  ["rosa", "pink"],
  ["lila", "violett", "purple", "violet"],
  ["gold", "golden"],
  ["silber", "silver"],
  ["tuerkis", "turquoise", "teal"],
  ["marine", "navy", "navyblue"],
  ["bordeaux", "weinrot", "burgundy", "maroon"],
  ["creme", "cream", "ivory", "elfenbein"],
  ["natur", "natural"],
  ["gemischt", "mehrfarbig", "bunt", "multi", "multicolor", "multicolour", "mixed"]
];
const SYNONYM_INDEX: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const g of COLOR_SYNONYM_GROUPS) for (const c of g) m.set(c, g);
  return m;
})();

// Canonical keys to try when matching a label against existing metaobjects:
// the label's own canonical form plus any known synonyms.
function matchCandidates(label: string): string[] {
  const canon = canonicalLabel(label);
  const group = SYNONYM_INDEX.get(canon);
  return group ? Array.from(new Set([canon, ...group])) : [canon];
}

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

const FILE_BY_FILENAME = `
  query FindFile($q: String!) {
    files(first: 1, query: $q) {
      edges { node { ... on MediaImage { id } ... on GenericFile { id } ... on Video { id } } }
    }
  }
`;

const FILE_CREATE = `
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { ... on MediaImage { id } ... on GenericFile { id } ... on Video { id } }
      userErrors { field message }
    }
  }
`;

// Last path segment of a URL, without the query string.
function filenameOfUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.pathname.split("/").pop() ?? "").trim();
  } catch {
    return (url.split("?")[0].split("/").pop() ?? "").trim();
  }
}

// Choose which metaobject field to populate when creating one from a bare
// label. Prefer a conventional label/name/title/value field, then the first
// single-line text field, then the first field defined.
function pickDisplayField(fields: Array<{ key: string; type: { name: string } }>): string | null {
  if (fields.length === 0) return null;
  const byName = fields.find((f) => DISPLAY_FIELD_KEYS.has(f.key.toLowerCase()));
  if (byName) return byName.key;
  const text = fields.find((f) => f.type.name === "single_line_text_field");
  if (text) return text.key;
  return fields[0].key;
}

// Best-effort value for a required metaobject field when creating one from a
// bare label. Currently fills color/swatch fields from the color-name map;
// returns null for fields we can't infer (caller lets Shopify report why).
function fillRequiredField(fd: MetaobjectFieldDef, label: string): string | null {
  if (/color/i.test(fd.type)) {
    const hex = COLOR_HEX[canonicalLabel(label)];
    if (!hex) return null;
    return fd.type.startsWith("list.") ? JSON.stringify([hex]) : hex;
  }
  return null;
}

function fileContentType(url: string): "IMAGE" | "VIDEO" | "FILE" {
  const lower = url.split("?")[0].toLowerCase();
  if (/\.(jpe?g|png|gif|webp|heic|bmp|svg|tiff?)$/.test(lower)) return "IMAGE";
  if (/\.(mp4|mov|webm|m4v)$/.test(lower)) return "VIDEO";
  return "FILE";
}

type Auth = { shopDomain: string; accessToken: string };

export class DestinationResolver {
  private cache = new Map<string, string | null>();
  // Cache: "<ownerType>|<ns>.<key>" -> metafield definition info (or null if absent).
  private defCache = new Map<string, MetafieldDefInfo | null>();
  // Cache: metaobject type -> map of lowercased displayName/field value -> GID.
  private metaobjectMaps = new Map<string, Map<string, string>>();
  // Global taxonomy value lookups (canonical name -> TaxonomyValue GID), loaded once.
  private taxonomyLoaded = false;
  private taxonomyColor = new Map<string, string>();
  private taxonomyPattern = new Map<string, string>();
  // A valid pattern GID (Solid) harvested from an existing color-pattern metaobject,
  // used as a fallback when the taxonomy query can't be reached.
  private harvestedPatternGid: string | null = null;

  constructor(private auth: Auth) {}

  /**
   * Primes the cache with a GID the caller just created, so a resource created
   * for one row is reused by the next instead of being looked up (and missed —
   * `resolve` caches nulls) again.
   */
  remember(portable: string, gid: string): void {
    if (portable && gid) this.cache.set(portable, gid);
  }

  async resolve(portable: string): Promise<string | null> {
    if (!portable) return null;
    if (this.cache.has(portable)) return this.cache.get(portable) ?? null;

    // file:<url> — the URL contains colons, so handle it before the ":" split.
    if (portable.startsWith("file:")) {
      const gid = await this.resolveFile(portable.slice("file:".length));
      this.cache.set(portable, gid);
      return gid;
    }

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

  // Resolve a file:<url> portable ref to a destination File GID. Reuses an
  // existing file with the same filename when present (so re-imports don't pile
  // up duplicates), otherwise uploads the file from its source URL.
  private async resolveFile(url: string): Promise<string | null> {
    if (!url) return null;
    try {
      const filename = filenameOfUrl(url);

      if (filename) {
        type FindResp = {
          data?: { files?: { edges?: Array<{ node: { id?: string } }> } };
        };
        const found = await shopifyGraphQLRequest<FindResp>({
          shopDomain: this.auth.shopDomain,
          accessToken: this.auth.accessToken,
          query: FILE_BY_FILENAME,
          variables: { q: `filename:${filename}` }
        });
        const existing = found.data?.files?.edges?.[0]?.node?.id;
        if (existing) return existing;
      }

      type CreateResp = {
        data?: {
          fileCreate?: {
            files?: Array<{ id?: string }>;
            userErrors?: Array<{ field: string[] | null; message: string }>;
          };
        };
        errors?: Array<{ message: string }>;
      };
      const created = await shopifyGraphQLRequest<CreateResp>({
        shopDomain: this.auth.shopDomain,
        accessToken: this.auth.accessToken,
        query: FILE_CREATE,
        variables: {
          files: [{ originalSource: url, contentType: fileContentType(url) }]
        }
      });
      if (created.data?.fileCreate?.userErrors?.length) return null;
      return created.data?.fileCreate?.files?.[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  // Resolve a reference metafield we only have display labels for (no portable
  // [ref] keys), e.g. custom.color = "Blau, Gelb". Looks up the metafield's real
  // type in the destination, then matches each label to a metaobject by display
  // name — creating the metaobject when it doesn't exist. Returns the value to
  // write (single GID or JSON array of GIDs) plus the resolved type, and appends
  // any per-label notes (unmatched/creation failures) to `notes`.
  async resolveByDisplayName(
    ownerType: MetaobjectOwnerType,
    namespace: string,
    key: string,
    rawValue: string,
    notes: string[]
  ): Promise<{ value: string; type: string } | null> {
    const def = await this.getMetafieldDef(ownerType, namespace, key);
    if (!def) {
      notes.push(`${namespace}.${key}: no metafield definition in target shop — can't resolve "${rawValue}" by name.`);
      return null;
    }
    if (!/(^|\.)metaobject_reference$/.test(def.type)) {
      notes.push(`${namespace}.${key} (${def.type}): only metaobject references resolve by display name — skipped.`);
      return null;
    }
    if (!def.metaobjectType) {
      notes.push(`${namespace}.${key}: target metaobject type unknown — skipped.`);
      return null;
    }

    const isList = def.type.startsWith("list.");
    const labels = isList
      ? rawValue.split(",").map((s) => s.trim()).filter(Boolean)
      : [rawValue.trim()].filter(Boolean);

    const gids: string[] = [];
    for (const label of labels) {
      const gid = await this.getOrCreateMetaobject(def, label, notes);
      if (gid) gids.push(gid);
    }
    if (gids.length === 0) return null;
    return { value: isList ? JSON.stringify(gids) : gids[0], type: def.type };
  }

  private async getMetafieldDef(
    ownerType: MetaobjectOwnerType,
    namespace: string,
    key: string
  ): Promise<MetafieldDefInfo | null> {
    const cacheKey = `${ownerType}|${namespace}.${key}`;
    const cached = this.defCache.get(cacheKey);
    if (cached !== undefined) return cached;

    let info: MetafieldDefInfo | null = null;
    try {
      type Resp = {
        data?: {
          metafieldDefinitions?: {
            edges?: Array<{ node: { type: { name: string }; validations: Array<{ name: string; value: string }> } }>;
          };
        };
      };
      const resp = await shopifyGraphQLRequest<Resp>({
        shopDomain: this.auth.shopDomain,
        accessToken: this.auth.accessToken,
        query: METAFIELD_DEFINITION,
        variables: { ownerType, namespace, key }
      });
      const node = resp.data?.metafieldDefinitions?.edges?.[0]?.node;
      if (node) {
        const type = node.type.name;
        const moDefGid = node.validations?.find((v) => v.name === "metaobject_definition_id")?.value ?? null;
        let metaobjectType: string | null = null;
        let displayFieldKey: string | null = null;
        let fields: MetaobjectFieldDef[] = [];
        if (moDefGid) {
          type MoResp = {
            data?: {
              metaobjectDefinition?: {
                type: string;
                fieldDefinitions: Array<{ key: string; required: boolean; type: { name: string } }>;
              } | null;
            };
          };
          const moResp = await shopifyGraphQLRequest<MoResp>({
            shopDomain: this.auth.shopDomain,
            accessToken: this.auth.accessToken,
            query: METAOBJECT_DEFINITION,
            variables: { id: moDefGid }
          });
          const moDef = moResp.data?.metaobjectDefinition;
          if (moDef) {
            metaobjectType = moDef.type;
            displayFieldKey = pickDisplayField(moDef.fieldDefinitions);
            fields = moDef.fieldDefinitions.map((f) => ({ key: f.key, type: f.type.name, required: f.required }));
          }
        }
        info = { type, metaobjectType, displayFieldKey, fields };
      }
    } catch {
      info = null;
    }
    this.defCache.set(cacheKey, info);
    return info;
  }

  private async getOrCreateMetaobject(
    def: MetafieldDefInfo,
    label: string,
    notes: string[]
  ): Promise<string | null> {
    const type = def.metaobjectType;
    if (!type) return null;
    const map = await this.metaobjectMap(type);
    const canon = canonicalLabel(label);
    for (const cand of matchCandidates(label)) {
      const hit = map.get(cand);
      if (hit) return hit;
    }

    // Build the create fields: the label goes in the display field, and every
    // OTHER required field is filled best-effort. Taxonomy references (Shopify's
    // standard color-pattern type) resolve to global TaxonomyValue GIDs; a
    // color/swatch field falls back to the color-name→hex map. Fields we can't
    // satisfy are attempted anyway so Shopify returns the precise reason.
    const needsTaxonomy = def.fields.some((f) => f.required && /taxonomy_value_reference/.test(f.type));
    if (needsTaxonomy) await this.ensureTaxonomy();

    const displayFieldKey = def.displayFieldKey ?? "label";
    const createFields: Array<{ key: string; value: string }> = [{ key: displayFieldKey, value: label }];
    const unfilled: string[] = [];
    for (const fd of def.fields) {
      if (fd.key === displayFieldKey || !fd.required) continue;
      const filled = this.fillRequiredValue(fd, label, notes);
      if (filled === null) {
        unfilled.push(`${fd.key} (${fd.type})`);
      } else {
        createFields.push({ key: fd.key, value: filled });
      }
    }

    try {
      type Resp = {
        data?: {
          metaobjectCreate?: {
            metaobject?: { id: string } | null;
            userErrors?: Array<{ field: string[] | null; message: string; code?: string | null }>;
          };
        };
        errors?: Array<{ message: string }>;
      };
      const resp = await shopifyGraphQLRequest<Resp>({
        shopDomain: this.auth.shopDomain,
        accessToken: this.auth.accessToken,
        query: METAOBJECT_CREATE,
        variables: { metaobject: { type, fields: createFields } }
      });
      const userErrors = resp.data?.metaobjectCreate?.userErrors ?? [];
      if (resp.errors?.length || userErrors.length) {
        const msg = [...(resp.errors ?? []).map((e) => e.message), ...userErrors.map((e) => e.message)].join("; ");
        const hint = unfilled.length ? ` (couldn't auto-fill required field(s): ${unfilled.join(", ")})` : "";
        notes.push(`Couldn't create ${type} "${label}": ${msg}${hint}`);
        return null;
      }
      const gid = resp.data?.metaobjectCreate?.metaobject?.id ?? null;
      if (gid) map.set(canon, gid);
      return gid;
    } catch {
      notes.push(`Couldn't create ${type} "${label}".`);
      return null;
    }
  }

  // Value for a required field when creating a metaobject from a bare label:
  // taxonomy references (color/pattern) resolve to global TaxonomyValue GIDs;
  // a color/swatch field falls back to the color-name→hex map. null = can't fill.
  private fillRequiredValue(fd: MetaobjectFieldDef, label: string, notes: string[]): string | null {
    if (/taxonomy_value_reference/.test(fd.type)) {
      const isList = fd.type.startsWith("list.");
      if (/color/i.test(fd.key)) {
        const gid = this.colorTaxGid(label);
        return gid ? (isList ? JSON.stringify([gid]) : gid) : null;
      }
      if (/pattern/i.test(fd.key)) {
        const gid = this.patternGid();
        return gid ? (isList ? JSON.stringify([gid]) : gid) : null;
      }
      return null;
    }
    const hex = fillRequiredField(fd, label);
    if (hex !== null && /color/i.test(fd.type) && NEUTRAL_HEX.has(canonicalLabel(label))) {
      notes.push(`Created "${label}" with a neutral swatch — adjust ${fd.key} in Shopify if needed.`);
    }
    return hex;
  }

  private colorTaxGid(label: string): string | null {
    for (const cand of matchCandidates(label)) {
      const gid = this.taxonomyColor.get(cand);
      if (gid) return gid;
    }
    return null;
  }

  private patternGid(): string | null {
    return (
      this.taxonomyPattern.get("solid") ??
      this.taxonomyPattern.values().next().value ??
      this.harvestedPatternGid
    );
  }

  // Load the global Color/Pattern taxonomy value maps once. Best-effort: on any
  // failure the maps stay empty and creation of taxonomy-backed metaobjects is
  // reported as unfillable rather than throwing.
  private async ensureTaxonomy(): Promise<void> {
    if (this.taxonomyLoaded) return;
    this.taxonomyLoaded = true;
    try {
      type Resp = {
        data?: {
          taxonomy?: {
            categories?: {
              edges?: Array<{
                node: {
                  attributes?: {
                    edges?: Array<{
                      node: { name?: string; values?: { edges?: Array<{ node: { id: string; name: string } }> } };
                    }>;
                  };
                };
              }>;
            };
          };
        };
      };
      // "shirt" reliably resolves to an apparel category carrying Color + Pattern.
      const resp = await shopifyGraphQLRequest<Resp>({
        shopDomain: this.auth.shopDomain,
        accessToken: this.auth.accessToken,
        query: TAXONOMY_ATTR_VALUES,
        variables: { search: "shirt" }
      });
      for (const cat of resp.data?.taxonomy?.categories?.edges ?? []) {
        for (const attr of cat.node.attributes?.edges ?? []) {
          const name = attr.node?.name;
          if (!name) continue;
          const target = /^color$/i.test(name)
            ? this.taxonomyColor
            : /^pattern$/i.test(name)
              ? this.taxonomyPattern
              : null;
          if (!target) continue;
          for (const v of attr.node.values?.edges ?? []) {
            const k = canonicalLabel(v.node.name);
            if (k && !target.has(k)) target.set(k, v.node.id);
          }
        }
        if (this.taxonomyColor.size > 0 && this.taxonomyPattern.size > 0) break;
      }
    } catch {
      // best-effort — leave maps empty.
    }
  }

  private async metaobjectMap(type: string): Promise<Map<string, string>> {
    const cached = this.metaobjectMaps.get(type);
    if (cached) return cached;

    const map = new Map<string, string>();
    let after: string | null = null;
    try {
      do {
        type Resp = {
          data?: {
            metaobjects?: {
              edges?: Array<{
                node: {
                  id: string;
                  handle: string | null;
                  displayName: string | null;
                  fields: Array<{ key: string; value: string | null }>;
                };
              }>;
              pageInfo?: { hasNextPage: boolean; endCursor: string | null };
            };
          };
        };
        const resp: Resp = await shopifyGraphQLRequest<Resp>({
          shopDomain: this.auth.shopDomain,
          accessToken: this.auth.accessToken,
          query: METAOBJECTS_BY_TYPE,
          variables: { type, after }
        });
        const conn = resp.data?.metaobjects;
        for (const edge of conn?.edges ?? []) {
          const node = edge.node;
          // Key every identifier by canonical form so umlaut/accent/spelling
          // differences ("Weiß" vs "weiss") still match. First writer wins.
          const addKey = (raw: string | null | undefined) => {
            if (!raw) return;
            const k = canonicalLabel(raw);
            if (k && !map.has(k)) map.set(k, node.id);
          };
          addKey(node.displayName);
          addKey(node.handle);
          for (const f of node.fields ?? []) addKey(f.value);
          // Harvest a valid pattern GID (almost always Solid) from an existing
          // color-pattern metaobject as a fallback for creating new ones.
          if (!this.harvestedPatternGid) {
            const pf = (node.fields ?? []).find(
              (f) => f.key === "pattern_taxonomy_reference" && f.value && f.value.startsWith("gid://")
            );
            if (pf?.value) this.harvestedPatternGid = pf.value;
          }
        }
        after = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
      } while (after);
    } catch {
      // best-effort — return whatever we mapped before the failure.
    }
    this.metaobjectMaps.set(type, map);
    return map;
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
