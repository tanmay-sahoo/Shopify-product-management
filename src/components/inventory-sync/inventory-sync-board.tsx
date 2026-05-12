"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import type { SyncGroupItem, SyncGroupWithItems, SyncMode } from "@/lib/inventory-sync/types";

import { CsvImportPanel } from "./csv-import-panel";
import { AutoMapPanel } from "./auto-map-panel";
import { GroupEditor } from "./group-editor";

type Tab = "groups" | "bulk" | "automap";

const MODE_LABELS: Record<SyncMode, string> = {
  mirror: "Mirror",
  shared_pool: "Shared Pool",
  bundle: "Bundle / Combo"
};

const MODE_BADGE: Record<SyncMode, string> = {
  mirror: "bg-brandSoft text-brand",
  shared_pool: "bg-emerald-50 text-emerald-700",
  bundle: "bg-amber-50 text-amber-700"
};

export function InventorySyncBoard({ initialGroups }: { initialGroups: SyncGroupWithItems[] }) {
  const [tab, setTab] = useState<Tab>("groups");
  const [groups, setGroups] = useState<SyncGroupWithItems[]>(initialGroups);
  const [filterMode, setFilterMode] = useState<SyncMode | "all">("all");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "paused">("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; group?: SyncGroupWithItems | null }>({ open: false });
  const [globalSyncing, setGlobalSyncing] = useState(false);
  const [toast, setToast] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/inventory-sync/groups");
    const body = await res.json();
    if (body.ok) setGroups(body.groups as SyncGroupWithItems[]);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const stats = useMemo(() => {
    const total = groups.length;
    const active = groups.filter((g) => g.active).length;
    const lastSyncMs = groups
      .map((g) => (g.lastSyncedAt ? new Date(g.lastSyncedAt).getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0);
    const errors = groups.filter((g) => g.lastError).length;
    return { total, active, lastSyncMs, errors };
  }, [groups]);

  const filtered = useMemo(() => {
    return groups.filter((g) => {
      if (filterMode !== "all" && g.mode !== filterMode) return false;
      if (filterActive === "active" && !g.active) return false;
      if (filterActive === "paused" && g.active) return false;
      if (search && !g.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [groups, filterMode, filterActive, search]);

  async function handleSync(group: SyncGroupWithItems, dryRun: boolean) {
    setBusyId(group.id);
    try {
      const res = await fetch(`/api/inventory-sync/groups/${group.id}/sync?dryRun=${dryRun}`, { method: "POST" });
      const body = await res.json();
      setToast({
        tone: body.ok ? "ok" : "err",
        text: `${group.name}: ${body.message}${dryRun ? " (dry-run)" : ""}`
      });
      await refresh();
    } catch (error) {
      setToast({ tone: "err", text: error instanceof Error ? error.message : "Sync failed" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleTogglePause(group: SyncGroupWithItems) {
    await fetch(`/api/inventory-sync/groups/${group.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !group.active })
    });
    await refresh();
  }

  async function handleDelete(group: SyncGroupWithItems) {
    if (!confirm(`Delete group "${group.name}"? This removes all its mappings.`)) return;
    await fetch(`/api/inventory-sync/groups/${group.id}`, { method: "DELETE" });
    await refresh();
  }

  async function handleSyncAll(dryRun: boolean) {
    setGlobalSyncing(true);
    try {
      const res = await fetch(`/api/inventory-sync/sync-all?dryRun=${dryRun}`, { method: "POST" });
      const body = await res.json();
      const total = (body.results ?? []).length;
      const ok = (body.results ?? []).filter((r: { ok: boolean }) => r.ok).length;
      setToast({ tone: ok === total ? "ok" : "err", text: `Synced ${ok}/${total} groups${dryRun ? " (dry-run)" : ""}` });
      await refresh();
    } finally {
      setGlobalSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Stat label="Total groups" value={stats.total} />
        <Stat label="Active" value={stats.active} tone="ok" />
        <Stat label="With errors" value={stats.errors} tone={stats.errors > 0 ? "err" : "default"} />
        <Stat
          label="Last sync"
          value={stats.lastSyncMs ? timeAgo(stats.lastSyncMs) : "Never"}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line/70 bg-white p-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: "groups", label: "Groups" },
              { id: "bulk", label: "Bulk import" },
              { id: "automap", label: "Auto-map" }
            ] as Array<{ id: Tab; label: string }>
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-xs font-semibold transition",
                tab === t.id ? "bg-ink text-white" : "text-muted hover:bg-canvas"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleSyncAll(true)}
            disabled={globalSyncing || groups.length === 0}
            className="rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-50"
          >
            Dry run all
          </button>
          <button
            onClick={() => handleSyncAll(false)}
            disabled={globalSyncing || groups.length === 0}
            className="rounded-xl bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {globalSyncing ? "Syncing…" : "Sync all"}
          </button>
          <button
            onClick={() => setEditor({ open: true, group: null })}
            className="rounded-xl bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            + Create group
          </button>
        </div>
      </div>

      {tab === "groups" ? (
        <section className="rounded-2xl border border-line/70 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={filterMode}
                onChange={(event) => setFilterMode(event.target.value as SyncMode | "all")}
                className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs font-medium text-ink"
              >
                <option value="all">All modes</option>
                <option value="mirror">Mirror</option>
                <option value="shared_pool">Shared pool</option>
                <option value="bundle">Bundle</option>
              </select>
              <select
                value={filterActive}
                onChange={(event) => setFilterActive(event.target.value as typeof filterActive)}
                className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs font-medium text-ink"
              >
                <option value="all">All states</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </div>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by group name"
              className="w-64 rounded-lg border border-line bg-white px-2 py-1.5 text-xs text-ink placeholder:text-muted"
            />
          </div>
          {filtered.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm font-medium text-ink">No linked-inventory groups yet</p>
              <p className="mt-1 text-xs text-muted">
                Create a group to start syncing stock or prices between variants.
              </p>
              <button
                onClick={() => setEditor({ open: true, group: null })}
                className="mt-4 rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
              >
                Create your first group
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-line/60">
              {filtered.map((group) => (
                <li key={group.id} className="px-4 py-3 hover:bg-canvas/50">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", MODE_BADGE[group.mode])}>
                          {MODE_LABELS[group.mode]}
                        </span>
                        <p className="truncate text-sm font-semibold text-ink">{group.name}</p>
                        {!group.active ? (
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            paused
                          </span>
                        ) : null}
                        {group.lastError ? (
                          <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-700">
                            error
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {summarizeItems(group)} · stock: {group.syncStock ? "on" : "off"} · price: {group.syncPrice ? "on" : "off"} ·
                        last sync: {group.lastSyncedAt ? timeAgo(new Date(group.lastSyncedAt).getTime()) : "never"}
                      </p>
                      {group.lastError ? (
                        <p className="mt-1 truncate text-xs text-rose-700">{group.lastError}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => handleSync(group, true)}
                        disabled={busyId === group.id}
                        className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-50"
                      >
                        Dry run
                      </button>
                      <button
                        onClick={() => handleSync(group, false)}
                        disabled={busyId === group.id}
                        className="rounded-lg bg-ink px-2.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {busyId === group.id ? "…" : "Sync now"}
                      </button>
                      <button
                        onClick={() => setEditor({ open: true, group })}
                        className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-canvas"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleTogglePause(group)}
                        className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-canvas"
                      >
                        {group.active ? "Pause" : "Resume"}
                      </button>
                      <button
                        onClick={() => handleDelete(group)}
                        className="rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "bulk" ? <CsvImportPanel onImported={() => refresh()} /> : null}
      {tab === "automap" ? <AutoMapPanel onCreated={() => refresh()} /> : null}

      {editor.open ? (
        <GroupEditor
          group={editor.group ?? null}
          onClose={() => setEditor({ open: false })}
          onSaved={() => {
            setEditor({ open: false });
            refresh();
          }}
        />
      ) : null}

      {toast ? (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border px-4 py-3 text-sm shadow-panel",
            toast.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          )}
        >
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}

function summarizeItems(group: SyncGroupWithItems): string {
  if (group.mode === "mirror") {
    const source = group.items.find((it: SyncGroupItem) => it.role === "source");
    const targets = group.items.filter((it: SyncGroupItem) => it.role === "target");
    return `${source ? "1 source" : "no source"} → ${targets.length} target${targets.length === 1 ? "" : "s"}`;
  }
  if (group.mode === "shared_pool") {
    return `${group.items.length} pool member${group.items.length === 1 ? "" : "s"}`;
  }
  const combos = group.items.filter((it: SyncGroupItem) => it.role === "combo").length;
  const components = group.items.filter((it: SyncGroupItem) => it.role === "component").length;
  return `${combos} combo · ${components} component${components === 1 ? "" : "s"}`;
}

function timeAgo(ms: number): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function Stat({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "ok" | "err" }) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-white p-4 shadow-sm",
        tone === "err" ? "border-rose-200" : tone === "ok" ? "border-emerald-200" : "border-line/70"
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold",
          tone === "err" ? "text-rose-700" : tone === "ok" ? "text-emerald-700" : "text-ink"
        )}
      >
        {value}
      </p>
    </div>
  );
}
