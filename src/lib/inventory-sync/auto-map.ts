import { getPrismaClient } from "@/lib/prisma";

type VariantLite = {
  shopifyVariantId: string;
  sku: string | null;
  title: string | null;
  productId: bigint;
  productTitle: string | null;
  productTags: string[];
};

async function loadVariants(storeId: number): Promise<VariantLite[]> {
  const prisma = getPrismaClient();
  const variants = await prisma.variant.findMany({
    where: { storeId: BigInt(storeId), NOT: { shopifyVariantId: null } },
    include: { product: { select: { id: true, title: true, tags: true } } }
  });
  return variants.map((v) => ({
    shopifyVariantId: v.shopifyVariantId!,
    sku: v.sku,
    title: v.title,
    productId: v.productId,
    productTitle: v.product.title,
    productTags: (v.product.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean)
  }));
}

export type Suggestion = {
  reason: "sku" | "tag" | "title";
  key: string;
  label: string;
  members: Array<{ shopifyVariantId: string; sku: string | null; title: string | null; productTitle: string | null }>;
};

export async function suggestBySku(storeId: number): Promise<Suggestion[]> {
  const variants = await loadVariants(storeId);
  const groups = new Map<string, VariantLite[]>();
  for (const v of variants) {
    const sku = (v.sku ?? "").trim();
    if (!sku) continue;
    const list = groups.get(sku) ?? [];
    list.push(v);
    groups.set(sku, list);
  }
  const out: Suggestion[] = [];
  for (const [sku, list] of groups) {
    if (list.length < 2) continue;
    out.push({
      reason: "sku",
      key: `sku:${sku}`,
      label: sku,
      members: list.map((v) => ({ shopifyVariantId: v.shopifyVariantId, sku: v.sku, title: v.title, productTitle: v.productTitle }))
    });
  }
  return out;
}

export async function suggestByTag(storeId: number): Promise<Suggestion[]> {
  const variants = await loadVariants(storeId);
  const groups = new Map<string, VariantLite[]>();
  for (const v of variants) {
    for (const tag of v.productTags) {
      const list = groups.get(tag) ?? [];
      list.push(v);
      groups.set(tag, list);
    }
  }
  const out: Suggestion[] = [];
  for (const [tag, list] of groups) {
    if (list.length < 2) continue;
    const unique = Array.from(new Map(list.map((v) => [v.shopifyVariantId, v])).values());
    if (unique.length < 2) continue;
    out.push({
      reason: "tag",
      key: `tag:${tag}`,
      label: tag,
      members: unique.map((v) => ({ shopifyVariantId: v.shopifyVariantId, sku: v.sku, title: v.title, productTitle: v.productTitle }))
    });
  }
  return out;
}

function normalizeTitle(s: string | null): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function suggestByTitle(storeId: number, minSharedTokens = 3): Promise<Suggestion[]> {
  const variants = await loadVariants(storeId);
  const tokenized = variants.map((v) => ({
    v,
    tokens: new Set(normalizeTitle(v.productTitle).split(" ").filter((t) => t.length > 2))
  }));

  const buckets = new Map<string, Array<(typeof tokenized)[number]>>();
  for (const item of tokenized) {
    for (const token of item.tokens) {
      const list = buckets.get(token) ?? [];
      list.push(item);
      buckets.set(token, list);
    }
  }

  const seenPairs = new Set<string>();
  const out: Suggestion[] = [];
  for (const items of buckets.values()) {
    if (items.length < 2) continue;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (a.v.shopifyVariantId === b.v.shopifyVariantId) continue;
        const pairKey = [a.v.shopifyVariantId, b.v.shopifyVariantId].sort().join("|");
        if (seenPairs.has(pairKey)) continue;
        let shared = 0;
        for (const t of a.tokens) if (b.tokens.has(t)) shared++;
        if (shared >= minSharedTokens) {
          seenPairs.add(pairKey);
          out.push({
            reason: "title",
            key: `title:${pairKey}`,
            label: `${a.v.productTitle ?? ""} ↔ ${b.v.productTitle ?? ""}`,
            members: [a.v, b.v].map((v) => ({
              shopifyVariantId: v.shopifyVariantId,
              sku: v.sku,
              title: v.title,
              productTitle: v.productTitle
            }))
          });
        }
      }
    }
  }
  return out;
}
