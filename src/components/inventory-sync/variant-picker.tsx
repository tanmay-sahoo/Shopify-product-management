"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export type VariantOption = {
  shopifyVariantId: string;
  shopifyProductId: string | null;
  inventoryItemId: string | null;
  sku: string | null;
  title: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  price: number | null;
  inventoryQuantity: number;
  productTitle: string | null;
  productHandle: string | null;
  productImage: string | null;
};

export function VariantPicker({
  value,
  onChange,
  multi = false,
  excludeIds = [],
  placeholder = "Search variant by SKU, title, product…"
}: {
  value: string[] | string | null;
  onChange: (selected: VariantOption[]) => void;
  multi?: boolean;
  excludeIds?: string[];
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<VariantOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = new URL("/api/inventory-sync/variants", typeof window === "undefined" ? "http://localhost" : window.location.origin);
    if (search) url.searchParams.set("search", search);
    fetch(url.pathname + url.search)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.ok) setOptions(body.variants as VariantOption[]);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [search]);

  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const exclude = new Set(excludeIds);

  function pick(option: VariantOption) {
    if (multi) {
      const set = new Set(selected);
      if (set.has(option.shopifyVariantId)) set.delete(option.shopifyVariantId);
      else set.add(option.shopifyVariantId);
      const newIds = Array.from(set);
      onChange(options.filter((o) => newIds.includes(o.shopifyVariantId)));
    } else {
      onChange([option]);
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted"
      />
      {open ? (
        <div className="absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-line bg-white shadow-panel">
          {loading ? <p className="px-3 py-2 text-xs text-muted">Searching…</p> : null}
          {!loading && options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No variants found. Sync the store first.</p>
          ) : null}
          {options.map((option) => {
            const isSelected = selected.includes(option.shopifyVariantId);
            const isExcluded = exclude.has(option.shopifyVariantId);
            return (
              <button
                key={option.shopifyVariantId}
                type="button"
                disabled={isExcluded}
                onClick={() => pick(option)}
                className={cn(
                  "flex w-full items-center gap-3 border-b border-line/40 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-canvas",
                  isSelected && "bg-brandSoft",
                  isExcluded && "cursor-not-allowed opacity-40"
                )}
              >
                {option.productImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={option.productImage} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
                ) : (
                  <div className="h-9 w-9 shrink-0 rounded-md bg-canvas" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{option.productTitle ?? "(untitled product)"}</p>
                  <p className="truncate text-[11px] text-muted">
                    {[option.option1, option.option2, option.option3].filter(Boolean).join(" · ") || option.title || "—"} ·
                    {option.sku ? ` SKU ${option.sku}` : " no SKU"} · stock {option.inventoryQuantity}
                  </p>
                </div>
                {isSelected ? <span className="text-xs font-bold text-brand">✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {open ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-hidden
          className="fixed inset-0 z-40 cursor-default"
        />
      ) : null}
    </div>
  );
}
