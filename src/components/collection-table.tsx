"use client";

import { Fragment, useMemo, useState } from "react";

import { Badge } from "@/components/badge";
import type { CollectionView, CollectionMetafieldView } from "@/lib/collections-service";
import type { StoreSummary } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

type Props = {
  collections: CollectionView[];
  store?: StoreSummary | null;
};

type TypeFilter = "" | "smart" | "custom";

function adminSlug(shopDomain?: string) {
  if (!shopDomain) return "your-store";
  return shopDomain.replace(/\.myshopify\.com$/i, "");
}

function numericId(gid: string) {
  const last = gid.split("/").pop() ?? gid;
  return last.split("?")[0];
}

function adminCollectionUrl(shopDomain: string | undefined, shopifyCollectionId: string) {
  return `https://admin.shopify.com/store/${adminSlug(shopDomain)}/collections/${numericId(shopifyCollectionId)}`;
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

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function CollectionTable({ collections, store }: Props) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [isExporting, setIsExporting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return collections.filter((collection) => {
      if (typeFilter === "smart" && !collection.isSmart) return false;
      if (typeFilter === "custom" && collection.isSmart) return false;
      if (!q) return true;
      const metaText = collection.metafields
        .map((mf) => `${mf.namespace}.${mf.key} ${mf.value ?? ""}`)
        .join(" ")
        .toLowerCase();
      return (
        collection.title.toLowerCase().includes(q) ||
        collection.handle.toLowerCase().includes(q) ||
        metaText.includes(q)
      );
    });
  }, [collections, query, typeFilter]);

  const totalMetafields = useMemo(
    () => collections.reduce((sum, collection) => sum + collection.metafields.length, 0),
    [collections]
  );

  const allExpanded = filtered.length > 0 && filtered.every((collection) => expanded.has(collection.id));

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allExpanded) {
      setExpanded(new Set());
    } else {
      setExpanded(new Set(filtered.map((collection) => collection.id)));
    }
  }

  async function handleExport() {
    setIsExporting(true);
    try {
      const response = await fetch("/api/collections/export", { method: "GET" });
      if (!response.ok) {
        throw new Error("Failed export");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `collections-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }

  const hasFilter = query.trim().length > 0 || typeFilter !== "";

  return (
    <div className="overflow-hidden rounded-3xl border border-line/80 bg-white/70 shadow-panel backdrop-blur">
      <div className="flex flex-col gap-4 border-b border-line/70 bg-gradient-to-r from-white via-white to-slate-50/60 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid w-full gap-3 lg:grid-cols-[minmax(0,1fr)_200px]">
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
              placeholder="Search title, handle, metafield"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
            className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none transition focus:border-brand focus:bg-white"
          >
            <option value="">All types</option>
            <option value="custom">Custom (manual)</option>
            <option value="smart">Smart (rule-based)</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasFilter ? (
            <button
              onClick={() => {
                setQuery("");
                setTypeFilter("");
              }}
              className="rounded-2xl border border-line bg-canvas px-3 py-3 text-sm font-medium text-muted transition hover:bg-white"
            >
              Reset
            </button>
          ) : null}
          <button
            onClick={toggleAll}
            disabled={filtered.length === 0}
            className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm font-semibold text-ink transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || collections.length === 0}
            className="rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isExporting ? "Exporting..." : "Export CSV"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 bg-slate-50/60 px-6 py-3 text-xs uppercase tracking-[0.18em] text-muted">
        <span className="font-semibold">
          {filtered.length} of {collections.length} collections
        </span>
        <span className="font-medium normal-case tracking-normal">
          {collections.filter((c) => c.isSmart).length} smart · {totalMetafields} metafields
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line/70 bg-white/60 text-left text-xs uppercase tracking-[0.16em] text-muted">
              <th className="w-10 px-4 py-3" />
              <th className="px-4 py-3 font-semibold">Title</th>
              <th className="px-4 py-3 font-semibold">Handle</th>
              <th className="px-4 py-3 font-semibold">Type</th>
              <th className="px-4 py-3 font-semibold">Products</th>
              <th className="px-4 py-3 font-semibold">Metafields</th>
              <th className="px-4 py-3 font-semibold">Updated</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-sm text-muted">
                  {collections.length === 0
                    ? "No collections synced yet. Run a store sync to pull collections from Shopify."
                    : "No collections match your search."}
                </td>
              </tr>
            ) : (
              filtered.map((collection) => {
                const isExpanded = expanded.has(collection.id);
                return (
                  <Fragment key={collection.id}>
                    <tr
                      className="cursor-pointer border-b border-line/50 transition hover:bg-slate-50/70"
                      onClick={() => toggle(collection.id)}
                    >
                      <td className="px-4 py-3 text-muted">
                        <ChevronIcon expanded={isExpanded} />
                      </td>
                      <td className="px-4 py-3 font-medium text-ink">{collection.title || "—"}</td>
                      <td className="px-4 py-3 text-muted">{collection.handle || "—"}</td>
                      <td className="px-4 py-3">
                        <Badge tone={collection.isSmart ? "info" : "neutral"}>
                          {collection.isSmart ? "Smart" : "Custom"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted">{collection.productsCount}</td>
                      <td className="px-4 py-3 text-muted">{collection.metafields.length}</td>
                      <td className="px-4 py-3 text-muted">{formatDate(collection.updatedAt)}</td>
                    </tr>
                    {isExpanded ? (
                      <tr className="border-b border-line/50 bg-slate-50/40">
                        <td />
                        <td colSpan={6} className="px-4 py-4">
                          <CollectionDetail collection={collection} store={store} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CollectionDetail({
  collection,
  store
}: {
  collection: CollectionView;
  store?: StoreSummary | null;
}) {
  const description = stripHtml(collection.bodyHtml);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DetailField label="Collection ID" value={numericId(collection.shopifyCollectionId)} mono />
        <DetailField label="Sort order" value={collection.sortOrder || "—"} />
        <DetailField label="Template suffix" value={collection.templateSuffix || "—"} />
        <DetailField
          label="Admin"
          value={
            <a
              href={adminCollectionUrl(store?.shopDomain, collection.shopifyCollectionId)}
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline"
            >
              Open in Shopify ↗
            </a>
          }
        />
        <DetailField label="SEO title" value={collection.seoTitle || "—"} />
        <DetailField
          label="SEO description"
          value={collection.seoDescription || "—"}
          className="sm:col-span-1 lg:col-span-3"
        />
      </div>

      {description ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted">Description</p>
          <p className="line-clamp-4 text-sm leading-6 text-ink/80">{description}</p>
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted">
          Metafields ({collection.metafields.length})
        </p>
        {collection.metafields.length === 0 ? (
          <p className="text-sm text-muted">No metafields on this collection.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line/70">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-white/70 text-left text-xs uppercase tracking-[0.14em] text-muted">
                  <th className="px-3 py-2 font-semibold">Namespace.key</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                {collection.metafields.map((mf) => (
                  <MetafieldRowView key={`${mf.namespace}.${mf.key}`} mf={mf} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MetafieldRowView({ mf }: { mf: CollectionMetafieldView }) {
  return (
    <tr className="border-t border-line/50">
      <td className="px-3 py-2 font-mono text-xs text-ink">
        {mf.namespace}.{mf.key}
      </td>
      <td className="px-3 py-2 text-muted">{mf.type}</td>
      <td className="max-w-md px-3 py-2 text-ink/80">
        <span className="line-clamp-2 break-words">{mf.value || "—"}</span>
      </td>
    </tr>
  );
}

function DetailField({
  label,
  value,
  mono,
  className
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className={cn("mt-1 text-sm text-ink", mono && "font-mono text-xs")}>{value}</p>
    </div>
  );
}
