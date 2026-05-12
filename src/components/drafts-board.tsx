"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/badge";
import type { DraftChange } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

type Props = {
  changes: DraftChange[];
};

type FilterStatus = "all" | DraftChange["status"];

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
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
    default:
      return key;
  }
}

export function DraftsBoard({ changes }: Props) {
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
      setMessage(`Updated ${selected.size} draft(s) → ${status}.`);
      setSelected(new Set());
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
        {filtered.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted">No drafts match this filter.</div>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.16em] text-muted">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                    className="h-4 w-4 cursor-pointer accent-brand"
                  />
                </th>
                <th className="w-8 px-2 py-3" aria-label="expand" />
                <th className="px-4 py-3 font-semibold">Summary</th>
                <th className="px-4 py-3 font-semibold">Entity</th>
                <th className="px-4 py-3 font-semibold">Change</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
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
                    <tr
                      className={cn(
                        "border-t border-line/70 align-middle",
                        isSelected && "bg-brandSoft/40"
                      )}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(change.id)}
                          className="h-4 w-4 cursor-pointer accent-brand"
                        />
                      </td>
                      <td className="px-2 py-3">
                        {hasDiff ? (
                          <button
                            onClick={() => toggleExpanded(change.id)}
                            className={cn(
                              "flex h-6 w-6 items-center justify-center rounded-md border transition",
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
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-medium text-ink">{change.summary}</td>
                      <td className="px-4 py-3 capitalize text-muted">{change.entityType}</td>
                      <td className="px-4 py-3 capitalize text-muted">{change.changeType}</td>
                      <td className="px-4 py-3">
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
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">{formatDate(change.createdAt)}</td>
                    </tr>
                    {isExpanded && hasDiff ? (
                      <tr className="border-t border-line/40 bg-slate-50/60">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="rounded-2xl border border-line bg-white p-4">
                            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                              Field changes
                            </p>
                            <div className="space-y-2">
                              {fieldKeys.map((key) => (
                                <div key={key} className="grid gap-2 text-xs lg:grid-cols-[140px_minmax(0,1fr)]">
                                  <span className="font-semibold text-ink">{fieldLabel(key)}</span>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {before && key in before ? (
                                      <>
                                        <span className="rounded-md bg-rose-50 px-2 py-0.5 font-mono text-[11px] text-rose-700 line-through">
                                          {formatValue((before as Record<string, unknown>)[key])}
                                        </span>
                                        <span className="text-muted">→</span>
                                      </>
                                    ) : null}
                                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-[11px] text-emerald-700">
                                      {formatValue((after as Record<string, unknown>)[key])}
                                    </span>
                                  </div>
                                </div>
                              ))}
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
        )}
      </div>
    </div>
  );
}
