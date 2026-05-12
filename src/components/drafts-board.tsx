"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/badge";
import type { DraftChange, StoreSummary } from "@/lib/types";
import { cn, currency, formatDate } from "@/lib/utils";

type Props = {
  changes: DraftChange[];
  store?: StoreSummary | null;
};

type FilterStatus = "all" | DraftChange["status"];

function formatValue(key: string, value: unknown, currencyCode?: string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  if ((key === "price" || key === "compareAtPrice") && typeof value === "number") {
    return currency(value, currencyCode);
  }
  return String(value);
}

function fieldLabel(key: string): string {
  switch (key) {
    case "title":
      return "Title";
    case "vendor":
      return "Vendor";
    case "productType":
      return "Type";
    case "status":
      return "Status";
    case "tags":
      return "Tags";
    case "seoTitle":
      return "SEO title";
    case "seoDescription":
      return "SEO description";
    case "bodyHtml":
      return "Description";
    case "sku":
      return "SKU";
    case "barcode":
      return "Barcode";
    case "price":
      return "Price";
    case "compareAtPrice":
      return "Compare-at";
    case "inventoryQuantity":
      return "Inventory";
    case "option1Value":
      return "Option 1";
    case "option2Value":
      return "Option 2";
    case "option3Value":
      return "Option 3";
    default:
      return key;
  }
}

export function DraftsBoard({ changes, store }: Props) {
  const currencyCode = store?.currencyCode ?? null;
  const router = useRouter();
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const filtered = changes.filter((change) => filter === "all" || change.status === filter);
  const counts = changes.reduce(
    (acc, change) => {
      acc[change.status] = (acc[change.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<DraftChange["status"], number>
  );

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((change) => change.id)));
    }
  }

  async function deleteOne(id: number) {
    if (!confirm("Delete this draft? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/drafts/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(typeof body?.error === "string" ? body.error : "Failed to delete draft.");
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} draft(s)? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await Promise.all(
        Array.from(selected).map((id) => fetch(`/api/drafts/${id}`, { method: "DELETE" }))
      );
      setMessage(`Deleted ${selected.size} draft(s).`);
      setSelected(new Set());
      router.refresh();
    } catch {
      setError("Failed to delete drafts.");
    } finally {
      setBusy(false);
    }
  }

  async function bulkUpdate(status: "approved" | "rejected") {
    if (selected.size === 0) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await Promise.all(
        Array.from(selected).map((id) =>
          fetch(`/api/drafts/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status })
          })
        )
      );
      setMessage(
        status === "approved"
          ? `Approved ${selected.size} draft(s). Click "Push to Shopify" to send them.`
          : `Rejected ${selected.size} draft(s).`
      );
      if (filter === "draft") {
        setFilter(status === "approved" ? "approved" : "rejected");
      }
      router.refresh();
    } catch {
      setError("Failed to update drafts.");
    } finally {
      setBusy(false);
    }
  }

  async function pushSelected() {
    const ids = changes
      .filter((change) => selected.has(change.id) && change.status === "approved")
      .map((change) => change.id);
    if (ids.length === 0) {
      setError("Only approved drafts can be pushed. Approve them first.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/drafts/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === "string" ? body.error : "Push failed.");
        return;
      }
      const pushed = Number(body?.pushed ?? 0);
      const failed = Number(body?.failed ?? 0);
      if (failed > 0) {
        const firstFailure = Array.isArray(body?.results)
          ? body.results.find((r: { ok: boolean }) => !r.ok)?.message
          : "";
        setError(
          `${failed} draft(s) failed to push.${firstFailure ? ` First error: ${firstFailure}` : ""}`
        );
        if (pushed > 0) setMessage(`Pushed ${pushed} draft(s) to Shopify.`);
      } else {
        setMessage(`Pushed ${pushed} draft(s) to Shopify.`);
      }
      setSelected(new Set());
      router.refresh();
    } catch {
      setError("Network error while pushing.");
    } finally {
      setBusy(false);
    }
  }

  const filters: { label: string; value: FilterStatus }[] = [
    { label: `All (${changes.length})`, value: "all" },
    { label: `Draft (${counts.draft ?? 0})`, value: "draft" },
    { label: `Approved (${counts.approved ?? 0})`, value: "approved" },
    { label: `Rejected (${counts.rejected ?? 0})`, value: "rejected" },
    { label: `Pushed (${counts.pushed ?? 0})`, value: "pushed" },
    { label: `Failed (${counts.failed ?? 0})`, value: "failed" }
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-line bg-white p-3 shadow-sm">
        <div className="flex flex-wrap gap-1">
          {filters.map((filterOption) => (
            <button
              key={filterOption.value}
              onClick={() => setFilter(filterOption.value)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-xs font-semibold transition",
                filter === filterOption.value
                  ? "bg-ink text-white"
                  : "bg-canvas text-muted hover:bg-slate-100"
              )}
            >
              {filterOption.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
          {error ? <p className="text-xs text-rose-700">{error}</p> : null}
          <button
            onClick={bulkDelete}
            disabled={busy || selected.size === 0}
            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Delete
          </button>
          <button
            onClick={() => bulkUpdate("rejected")}
            disabled={busy || selected.size === 0}
            className="rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={() => bulkUpdate("approved")}
            disabled={busy || selected.size === 0}
            className="rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={pushSelected}
            disabled={busy || selected.size === 0}
            className="rounded-xl bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-panel disabled:cursor-not-allowed disabled:opacity-50"
          >
            Push to Shopify
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-line/70 px-6 py-2.5 text-[11px] uppercase tracking-[0.16em] text-muted">
          <input
            type="checkbox"
            checked={selected.size === filtered.length && filtered.length > 0}
            onChange={toggleAll}
            className="h-4 w-4 cursor-pointer accent-brand"
          />
          <span className="ml-2 font-semibold">
            Showing {filtered.length} of {changes.length} drafts
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted">No drafts match this filter.</div>
        ) : (
          <ul className="divide-y divide-line/70">
            {filtered.map((change) => {
              const isSelected = selected.has(change.id);
              const isExpanded = expanded.has(change.id);
              const after = change.afterData ?? {};
              const before = change.beforeData ?? {};
              const fieldKeys = Object.keys(after).filter(
                (key) => key !== "action" || typeof after[key] === "object"
              );
              const hasDiff = fieldKeys.length > 0;

              return (
                <Fragment key={change.id}>
                  <li
                    className={cn(
                      "flex flex-col gap-3 px-6 py-4 transition lg:flex-row lg:items-center",
                      isSelected && "bg-brandSoft/40"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(change.id)}
                        className="mt-1 h-4 w-4 cursor-pointer accent-brand"
                      />
                      {hasDiff ? (
                        <button
                          onClick={() => toggleExpanded(change.id)}
                          className={cn(
                            "mt-0.5 flex h-6 w-6 items-center justify-center rounded-md border transition",
                            isExpanded
                              ? "border-brand bg-brand text-white"
                              : "border-line bg-white text-muted hover:border-brand"
                          )}
                          aria-label={isExpanded ? "Hide diff" : "Show diff"}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-90")}>
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                      ) : (
                        <span className="mt-0.5 block h-6 w-6" aria-hidden />
                      )}
                    </div>

                    <div
                      className="h-14 w-14 shrink-0 rounded-2xl bg-cover bg-center bg-slate-100 ring-1 ring-line"
                      style={{
                        backgroundImage: change.product?.imageSrc
                          ? `url(${change.product.imageSrc})`
                          : undefined
                      }}
                    />

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-ink">
                          {change.product?.title ?? `Untitled ${change.entityType}`}
                        </p>
                        <Badge
                          tone={
                            change.entityType === "variant"
                              ? "info"
                              : change.changeType === "create"
                              ? "valid"
                              : change.changeType === "delete"
                              ? "error"
                              : "neutral"
                          }
                        >
                          {change.entityType} · {change.changeType}
                        </Badge>
                      </div>

                      {change.product?.handle ? (
                        <p className="truncate text-[11px] text-muted">{change.product.handle}</p>
                      ) : null}

                      {change.variant ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-ink/80">
                            Variant: {change.variant.title || "(default)"}
                          </span>
                          {change.variant.sku ? (
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-muted">
                              {change.variant.sku}
                            </span>
                          ) : null}
                          {change.variant.options.map((option, i) => (
                            <span
                              key={`${change.variant!.id}-opt-${i}`}
                              className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-muted"
                            >
                              {option}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {hasDiff ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {fieldKeys.map((key) => (
                            <span
                              key={key}
                              className="rounded-md bg-brandSoft px-2 py-0.5 text-[10px] font-semibold text-brand"
                            >
                              {fieldLabel(key)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-3 lg:flex-col lg:items-end">
                      <Badge
                        tone={
                          change.status === "failed"
                            ? "error"
                            : change.status === "approved"
                            ? "valid"
                            : change.status === "draft"
                            ? "warning"
                            : "info"
                        }
                      >
                        {change.status}
                      </Badge>
                      <p className="text-[11px] text-muted">{formatDate(change.createdAt)}</p>
                      <button
                        onClick={() => deleteOne(change.id)}
                        disabled={busy}
                        title="Delete draft"
                        aria-label="Delete draft"
                        className="rounded-lg border border-line bg-white p-1.5 text-rose-700 transition hover:border-rose-200 hover:bg-rose-50 disabled:opacity-50"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </li>

                  {isExpanded && hasDiff ? (
                    <li className="border-t border-line/40 bg-slate-50/60 px-6 py-4">
                      <div className="rounded-2xl border border-line bg-white p-4">
                        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                          Field changes
                        </p>
                        <div className="space-y-2">
                          {fieldKeys.map((key) => {
                            const beforeValue = (before as Record<string, unknown>)[key];
                            const afterValue = (after as Record<string, unknown>)[key];
                            const hasBefore = before && key in before;
                            return (
                              <div
                                key={key}
                                className="grid gap-2 text-xs lg:grid-cols-[160px_minmax(0,1fr)]"
                              >
                                <span className="font-semibold text-ink">{fieldLabel(key)}</span>
                                <div className="flex flex-wrap items-center gap-2">
                                  {hasBefore ? (
                                    <>
                                      <span className="rounded-md bg-rose-50 px-2 py-0.5 font-mono text-[11px] text-rose-700 line-through">
                                        {formatValue(key, beforeValue, currencyCode)}
                                      </span>
                                      <span className="text-muted">→</span>
                                    </>
                                  ) : (
                                    <span className="text-[10px] uppercase tracking-wider text-muted">
                                      New value
                                    </span>
                                  )}
                                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-[11px] text-emerald-700">
                                    {formatValue(key, afterValue, currencyCode)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </li>
                  ) : null}
                </Fragment>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
