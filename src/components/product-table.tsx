"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/badge";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { ProductEditor } from "@/components/product-editor";
import type { Product, ProductStatus, StoreSummary, Variant } from "@/lib/types";
import { cn, currency, formatDate } from "@/lib/utils";

type Props = {
  products: Product[];
  store?: StoreSummary;
};

function adminSlug(shopDomain?: string) {
  if (!shopDomain) return "your-store";
  return shopDomain.replace(/\.myshopify\.com$/i, "");
}

function storefrontUrl(shopDomain: string | undefined, handle: string) {
  const host = shopDomain ?? "your-store.myshopify.com";
  return `https://${host}/products/${handle}`;
}

function adminProductUrl(shopDomain: string | undefined, productId: number) {
  return `https://admin.shopify.com/store/${adminSlug(shopDomain)}/products/${productId}`;
}

function statusTone(status: ProductStatus): "valid" | "warning" | "neutral" {
  if (status === "active") return "valid";
  if (status === "draft") return "warning";
  return "neutral";
}

function variantImage(variant: Variant, fallback?: string) {
  return (
    variant.variantImages.find((image) => image.isPrimary)?.src ??
    variant.variantImages[0]?.src ??
    variant.image ??
    fallback ??
    ""
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("transition-transform duration-200", expanded && "rotate-90")}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function ProductTable({ products, store }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editorProduct, setEditorProduct] = useState<Product | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("edit");
  const [editorOpen, setEditorOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const vendors = useMemo(
    () => Array.from(new Set(products.map((p) => p.vendor).filter(Boolean))).sort(),
    [products]
  );
  const types = useMemo(
    () => Array.from(new Set(products.map((p) => p.productType).filter(Boolean))).sort(),
    [products]
  );
  const statuses = useMemo(
    () => Array.from(new Set(products.map((p) => p.status))).sort(),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((product) => {
      if (vendorFilter && product.vendor !== vendorFilter) return false;
      if (typeFilter && product.productType !== typeFilter) return false;
      if (statusFilter && product.status !== statusFilter) return false;
      if (!q) return true;

      const variantSkus = product.variants.map((variant) => variant.sku.toLowerCase()).join(" ");
      return (
        product.title.toLowerCase().includes(q) ||
        product.handle.toLowerCase().includes(q) ||
        product.vendor.toLowerCase().includes(q) ||
        product.productType.toLowerCase().includes(q) ||
        product.tags.join(" ").toLowerCase().includes(q) ||
        variantSkus.includes(q)
      );
    });
  }, [products, query, vendorFilter, typeFilter, statusFilter]);

  function openEditor(product: Product | null) {
    setEditorProduct(product);
    setEditorMode(product ? "edit" : "create");
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditorProduct(null);
  }

  function handleSaved() {
    router.refresh();
  }

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllExpanded() {
    const variantProductIds = filteredProducts.filter((p) => p.variants.length > 1).map((p) => p.id);
    if (variantProductIds.length === 0) return;
    if (expanded.size === variantProductIds.length) {
      setExpanded(new Set());
    } else {
      setExpanded(new Set(variantProductIds));
    }
  }

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filteredProducts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredProducts.map((p) => p.id)));
    }
  }

  async function handleExport() {
    setIsExporting(true);
    try {
      const response = await fetch("/api/products/export", { method: "GET" });
      if (!response.ok) {
        throw new Error("Failed export");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `products-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }

  function resetFilters() {
    setQuery("");
    setVendorFilter("");
    setTypeFilter("");
    setStatusFilter("");
  }

  const hasActiveFilter = query || vendorFilter || typeFilter || statusFilter;
  const variantProductCount = filteredProducts.filter((p) => p.variants.length > 1).length;
  const allExpanded = variantProductCount > 0 && expanded.size === variantProductCount;
  const allSelected = selected.size === filteredProducts.length && filteredProducts.length > 0;
  const totalVariants = filteredProducts.reduce((acc, p) => acc + p.variants.length, 0);

  return (
    <>
      <div className="overflow-hidden rounded-3xl border border-line/80 bg-white/70 shadow-panel backdrop-blur">
        <div className="flex flex-col gap-4 border-b border-line/70 bg-gradient-to-r from-white via-white to-slate-50/60 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid w-full gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_180px]">
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-2xl border border-line bg-canvas pl-10 pr-4 py-3 text-sm outline-none transition focus:border-brand focus:bg-white"
                placeholder="Search title, handle, vendor, SKU, tag"
              />
            </div>
            <select
              value={vendorFilter}
              onChange={(event) => setVendorFilter(event.target.value)}
              className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none transition focus:border-brand focus:bg-white"
            >
              <option value="">All vendors</option>
              {vendors.map((vendor) => (
                <option key={vendor} value={vendor}>
                  {vendor}
                </option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none transition focus:border-brand focus:bg-white"
            >
              <option value="">All types</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none transition focus:border-brand focus:bg-white"
            >
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasActiveFilter ? (
              <button
                onClick={resetFilters}
                className="rounded-2xl border border-line bg-canvas px-3 py-3 text-sm font-medium text-muted transition hover:bg-white"
              >
                Reset
              </button>
            ) : null}
            <button
              onClick={toggleAllExpanded}
              className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm font-semibold text-ink transition hover:bg-white"
            >
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isExporting ? "Exporting..." : "Export CSV"}
            </button>
            <button
              onClick={() => openEditor(null)}
              className="rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-panel transition hover:opacity-90"
            >
              + New product
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 bg-slate-50/60 px-6 py-3 text-xs uppercase tracking-[0.18em] text-muted">
          <span className="font-semibold">
            {filteredProducts.length} of {products.length} products · {totalVariants} variants
          </span>
          <span className="font-medium normal-case tracking-normal">
            {types.length} custom types · {vendors.length} vendors
            {selected.size > 0 ? (
              <span className="ml-3 rounded-full bg-brand px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
                {selected.size} selected
              </span>
            ) : null}
          </span>
        </div>

        <div className="overflow-x-auto">
          {filteredProducts.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted">
              No products match this filter. If this is the first run, click `Sync now` in the top bar.
            </div>
          ) : null}
          {filteredProducts.length > 0 ? (
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50/80 text-[11px] uppercase tracking-[0.16em] text-muted">
                <tr>
                  <th className="w-10 px-4 py-4">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 cursor-pointer accent-brand"
                    />
                  </th>
                  <th className="w-10 px-2 py-4" aria-label="expand" />
                  <th className="px-4 py-4 font-semibold">Product</th>
                  <th className="px-4 py-4 font-semibold">Vendor</th>
                  <th className="px-4 py-4 font-semibold">Type</th>
                  <th className="px-4 py-4 font-semibold">Status</th>
                  <th className="px-4 py-4 font-semibold">Variants</th>
                  <th className="px-4 py-4 font-semibold">Inventory</th>
                  <th className="px-4 py-4 font-semibold">Updated</th>
                  <th className="px-4 py-4 font-semibold">Links</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const isExpanded = expanded.has(product.id);
                  const isSelected = selected.has(product.id);
                  const totalInventory = product.variants.reduce(
                    (sum, variant) => sum + variant.inventoryQuantity,
                    0
                  );
                  const hasVariants = product.variants.length > 1;

                  return (
                    <Fragment key={product.id}>
                      <tr
                        className={cn(
                          "group cursor-pointer border-t border-line/70 align-middle transition",
                          isSelected ? "bg-brandSoft/40" : "hover:bg-slate-50/80"
                        )}
                        onClick={() => openEditor(product)}
                      >
                        <td className="px-4 py-4" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelected(product.id)}
                            className="h-4 w-4 cursor-pointer accent-brand"
                          />
                        </td>
                        <td className="px-2 py-4" onClick={(event) => event.stopPropagation()}>
                          {hasVariants ? (
                            <button
                              onClick={() => toggleExpanded(product.id)}
                              className={cn(
                                "flex h-8 w-8 items-center justify-center rounded-xl border transition",
                                isExpanded
                                  ? "border-brand bg-brand text-white"
                                  : "border-line bg-white text-ink hover:border-brand hover:text-brand"
                              )}
                              aria-label={isExpanded ? "Collapse variants" : "Expand variants"}
                            >
                              <ChevronIcon expanded={isExpanded} />
                            </button>
                          ) : (
                            <span className="block h-8 w-8" aria-hidden />
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-4">
                            <div
                              className="h-14 w-14 shrink-0 rounded-2xl bg-cover bg-center bg-slate-100 ring-1 ring-line"
                              style={{ backgroundImage: `url(${product.images[0]?.src ?? ""})` }}
                            />
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-ink">{product.title}</p>
                              <p className="mt-0.5 text-xs text-muted">{product.handle}</p>
                              {product.tags.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {product.tags.slice(0, 3).map((tag) => (
                                    <span
                                      key={tag}
                                      className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-muted"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                  {product.tags.length > 3 ? (
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-muted">
                                      +{product.tags.length - 3}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-ink/80">{product.vendor || "—"}</td>
                        <td className="px-4 py-4">
                          {product.productType ? (
                            <span className="inline-flex rounded-xl bg-brandSoft px-2.5 py-1 text-xs font-semibold text-brand">
                              {product.productType}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <Badge tone={statusTone(product.status)}>{product.status}</Badge>
                        </td>
                        <td className="px-4 py-4">
                          {hasVariants ? (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleExpanded(product.id);
                              }}
                              className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand"
                            >
                              <span>{product.variants.length}</span>
                              <span className="text-[10px] uppercase tracking-wider text-muted">
                                {isExpanded ? "Hide" : "Show"}
                              </span>
                            </button>
                          ) : (
                            <span className="text-xs text-muted">Single</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={cn(
                              "inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold",
                              totalInventory === 0
                                ? "bg-rose-50 text-rose-700"
                                : totalInventory < 10
                                ? "bg-amber-50 text-amber-700"
                                : "bg-emerald-50 text-emerald-700"
                            )}
                          >
                            {totalInventory}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-xs text-muted">{formatDate(product.updatedAt)}</td>
                        <td className="px-4 py-4 text-xs" onClick={(event) => event.stopPropagation()}>
                          <div className="flex flex-col gap-1">
                            <a
                              href={storefrontUrl(store?.shopDomain, product.handle)}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-brand hover:underline"
                            >
                              Storefront ↗
                            </a>
                            <a
                              href={adminProductUrl(store?.shopDomain, product.id)}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-brand hover:underline"
                            >
                              Admin ↗
                            </a>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && hasVariants ? (
                        <tr className="border-t border-line/40 bg-slate-50/60">
                          <td colSpan={10} className="px-0 py-0">
                            <div className="px-4 pb-5 pt-3 lg:px-10">
                              <div className="overflow-hidden rounded-2xl border border-line/70 bg-white shadow-sm">
                                <div className="flex items-center justify-between border-b border-line/60 bg-slate-50/80 px-5 py-3">
                                  <div className="flex items-center gap-3">
                                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-xs font-bold text-white">
                                      {product.variants.length}
                                    </span>
                                    <p className="text-sm font-semibold text-ink">
                                      Variants linked to {product.title}
                                    </p>
                                  </div>
                                  <span className="text-[11px] uppercase tracking-[0.18em] text-muted">
                                    SKU-level inventory
                                  </span>
                                </div>
                                <table className="min-w-full text-left text-sm">
                                  <thead className="bg-white text-[11px] uppercase tracking-[0.14em] text-muted">
                                    <tr>
                                      <th className="px-5 py-3 font-semibold">Variant</th>
                                      <th className="px-4 py-3 font-semibold">SKU</th>
                                      <th className="px-4 py-3 font-semibold">Options</th>
                                      <th className="px-4 py-3 font-semibold">Price</th>
                                      <th className="px-4 py-3 font-semibold">Compare</th>
                                      <th className="px-4 py-3 font-semibold">Inventory</th>
                                      <th className="px-4 py-3 font-semibold">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {product.variants.map((variant, index) => {
                                      const isLast = index === product.variants.length - 1;
                                      return (
                                        <tr
                                          key={variant.id}
                                          className="border-t border-line/50 align-middle transition hover:bg-slate-50/80"
                                        >
                                          <td className="px-5 py-3">
                                            <div className="flex items-center gap-3">
                                              <div className="relative flex h-10 w-6 shrink-0 items-center justify-center">
                                                <span className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2 bg-line" />
                                                {!isLast ? (
                                                  <span className="absolute left-1/2 top-1/2 h-1/2 w-px -translate-x-1/2 bg-line" />
                                                ) : null}
                                                <span className="absolute left-1/2 top-1/2 h-px w-3 -translate-y-1/2 bg-line" />
                                                <span className="relative z-10 h-2 w-2 rounded-full bg-brand" />
                                              </div>
                                              <div
                                                className="h-10 w-10 shrink-0 rounded-xl bg-cover bg-center bg-slate-100 ring-1 ring-line"
                                                style={{
                                                  backgroundImage: `url(${variantImage(variant, product.images[0]?.src)})`
                                                }}
                                              />
                                              <div className="min-w-0">
                                                <p className="truncate text-sm font-medium text-ink">
                                                  {variant.title}
                                                </p>
                                                {variant.validationLevel ? (
                                                  <div className="mt-1">
                                                    <Badge tone={variant.validationLevel}>
                                                      {variant.validationLevel}
                                                    </Badge>
                                                  </div>
                                                ) : null}
                                              </div>
                                            </div>
                                          </td>
                                          <td className="px-4 py-3 font-mono text-xs text-ink/80">
                                            {variant.sku || "—"}
                                          </td>
                                          <td className="px-4 py-3">
                                            <div className="flex flex-wrap gap-1">
                                              {[variant.option1Value, variant.option2Value, variant.option3Value]
                                                .filter(Boolean)
                                                .map((option, idx) => (
                                                  <span
                                                    key={`${variant.id}-opt-${idx}`}
                                                    className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-ink/70"
                                                  >
                                                    {option}
                                                  </span>
                                                ))}
                                            </div>
                                          </td>
                                          <td className="px-4 py-3 text-sm font-semibold text-ink">
                                            {currency(variant.price)}
                                          </td>
                                          <td className="px-4 py-3 text-xs text-muted">
                                            {variant.compareAtPrice ? currency(variant.compareAtPrice) : "—"}
                                          </td>
                                          <td className="px-4 py-3">
                                            <span
                                              className={cn(
                                                "inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold",
                                                variant.inventoryQuantity === 0
                                                  ? "bg-rose-50 text-rose-700"
                                                  : variant.inventoryQuantity < 10
                                                  ? "bg-amber-50 text-amber-700"
                                                  : "bg-emerald-50 text-emerald-700"
                                              )}
                                            >
                                              {variant.inventoryQuantity}
                                            </span>
                                          </td>
                                          <td className="px-4 py-3">
                                            <Badge tone={statusTone(variant.status)}>{variant.status}</Badge>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>

      <BulkActionBar
        selectedIds={Array.from(selected)}
        vendors={vendors}
        productTypes={types}
        onClear={() => setSelected(new Set())}
        onApplied={handleSaved}
      />

      <ProductEditor
        open={editorOpen}
        mode={editorMode}
        product={editorProduct}
        vendors={vendors}
        productTypes={types}
        onClose={closeEditor}
        onSaved={handleSaved}
      />
    </>
  );
}
