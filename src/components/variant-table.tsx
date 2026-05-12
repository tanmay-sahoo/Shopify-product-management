"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/badge";
import type { Product, Variant } from "@/lib/types";
import { currency, formatDate } from "@/lib/utils";

type Props = {
  variants: Variant[];
  products?: Product[];
};

const priceBuckets = [
  { label: "All price ranges", value: "" },
  { label: "Under $20", value: "0-20" },
  { label: "$20 - $50", value: "20-50" },
  { label: "$50 - $100", value: "50-100" },
  { label: "$100+", value: "100-" }
];

function withinBucket(price: number, bucket: string) {
  if (!bucket) return true;
  const [minStr, maxStr] = bucket.split("-");
  const min = Number(minStr);
  const max = maxStr === "" ? Infinity : Number(maxStr);
  return price >= min && price < max;
}

export function VariantTable({ variants, products = [] }: Props) {
  const [query, setQuery] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [priceFilter, setPriceFilter] = useState("");

  const productOptions = useMemo(() => {
    if (products.length > 0) {
      return products.map((p) => ({ id: p.id, title: p.title }));
    }
    const map = new Map<number, string>();
    for (const variant of variants) {
      if (!map.has(variant.productId)) {
        map.set(variant.productId, variant.title.split(" / ")[0] ?? `Product ${variant.productId}`);
      }
    }
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }));
  }, [products, variants]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return variants.filter((variant) => {
      if (productFilter && String(variant.productId) !== productFilter) return false;
      if (!withinBucket(variant.price, priceFilter)) return false;
      if (!q) return true;
      return (
        variant.sku.toLowerCase().includes(q) ||
        variant.title.toLowerCase().includes(q) ||
        (variant.barcode ?? "").toLowerCase().includes(q)
      );
    });
  }, [variants, query, productFilter, priceFilter]);

  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-line bg-panel shadow-panel">
      <div className="flex flex-col gap-4 border-b border-line px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid w-full gap-3 lg:grid-cols-[minmax(0,1fr)_220px_180px]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none"
            placeholder="Search by SKU, title, or barcode"
          />
          <select
            value={productFilter}
            onChange={(event) => setProductFilter(event.target.value)}
            className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none"
          >
            <option value="">All products</option>
            {productOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
          <select
            value={priceFilter}
            onChange={(event) => setPriceFilter(event.target.value)}
            className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none"
          >
            {priceBuckets.map((bucket) => (
              <option key={bucket.value} value={bucket.value}>
                {bucket.label}
              </option>
            ))}
          </select>
        </div>
        <button className="rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink">
          Bulk price update
        </button>
      </div>

      <div className="border-b border-line px-6 py-3 text-xs uppercase tracking-[0.18em] text-muted">
        {filtered.length} of {variants.length} variants
      </div>

      <div className="overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="px-6 py-10 text-sm text-muted">No variants match this filter.</div>
        ) : null}
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-muted">
            <tr>
              {["Variant", "SKU", "Option 1", "Option 2", "Price", "Compare", "Inventory", "Status", "Updated"].map(
                (label) => (
                  <th key={label} className="px-6 py-4 font-semibold">
                    {label}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((variant) => (
              <tr key={variant.id} className="border-t border-line align-top">
                <td className="px-6 py-5">
                  <div className="flex items-center gap-4">
                    <div
                      className="h-12 w-12 rounded-2xl bg-cover bg-center bg-slate-100"
                      style={{ backgroundImage: `url(${variant.image ?? ""})` }}
                    />
                    <div>
                      <p className="font-medium text-ink">{variant.title}</p>
                      {variant.validationLevel ? (
                        <div className="mt-2">
                          <Badge tone={variant.validationLevel}>{variant.validationLevel}</Badge>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-5 text-muted">{variant.sku}</td>
                <td className="px-6 py-5 text-muted">{variant.option1Value}</td>
                <td className="px-6 py-5 text-muted">{variant.option2Value ?? "-"}</td>
                <td className="px-6 py-5 text-muted">{currency(variant.price)}</td>
                <td className="px-6 py-5 text-muted">
                  {variant.compareAtPrice ? currency(variant.compareAtPrice) : "-"}
                </td>
                <td className="px-6 py-5 text-muted">{variant.inventoryQuantity}</td>
                <td className="px-6 py-5">
                  <Badge tone="info">{variant.status}</Badge>
                </td>
                <td className="px-6 py-5 text-muted">{formatDate(variant.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
