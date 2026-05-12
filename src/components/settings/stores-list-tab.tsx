"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { StoreEditModal } from "@/components/settings/store-edit-modal";
import type { StoreSummary } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

type Props = {
  stores: StoreSummary[];
  activeStoreId: number;
  flashStatus?: string;
  flashShop?: string;
  flashScopes?: string;
  flashMessage?: string;
  onGoToConnect: () => void;
};

export function StoresListTab({
  stores,
  activeStoreId,
  flashStatus,
  flashShop,
  flashScopes,
  flashMessage,
  onGoToConnect
}: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<StoreSummary | null>(null);

  async function setActive(id: number) {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch("/api/stores/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(typeof body?.error === "string" ? body.error : "Failed to switch store.");
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function disconnect(id: number, shopDomain: string) {
    if (!confirm(`Disconnect ${shopDomain}? Token is cleared but data is kept; you can reconnect later.`)) {
      return;
    }
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/stores/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(typeof body?.error === "string" ? body.error : "Failed to disconnect store.");
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function hardDelete(id: number, shopDomain: string) {
    if (
      !confirm(
        `PERMANENTLY delete ${shopDomain}? This removes the store and every product, variant, image, draft, import, and sync log linked to it. Cannot be undone.`
      )
    ) {
      return;
    }
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/stores/${id}?hard=true`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(typeof body?.error === "string" ? body.error : "Failed to delete store.");
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      {flashStatus === "success" ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <p className="font-semibold">Store connected.</p>
          <p className="mt-1">
            {flashShop ?? ""}
            {flashScopes ? <span className="text-emerald-700/80"> · {flashScopes}</span> : null}
          </p>
        </div>
      ) : null}
      {flashStatus === "error" ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-semibold">Connection failed.</p>
          <p className="mt-1">Reason: {flashMessage ?? "unknown_error"}</p>
        </div>
      ) : null}
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>
      ) : null}

      <section className="rounded-3xl border border-line bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-ink">Connected stores</h3>
            <p className="mt-0.5 text-xs text-muted">
              {stores.length} store{stores.length === 1 ? "" : "s"} · click "Make active" to switch context
            </p>
          </div>
          <button
            onClick={onGoToConnect}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-panel hover:opacity-90"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Connect store
          </button>
        </div>

        {stores.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted">
            No stores connected yet. Click <span className="font-semibold text-ink">Connect store</span> to start.
          </div>
        ) : (
          <ul className="divide-y divide-line/70">
            {stores.map((store) => {
              const isActive = store.id === activeStoreId;
              const isUninstalled = store.status === "uninstalled";
              return (
                <li
                  key={store.id}
                  className={cn(
                    "flex flex-col gap-3 px-6 py-4 transition lg:flex-row lg:items-center lg:justify-between",
                    isActive && "bg-brandSoft/40"
                  )}
                >
                  <div className="flex flex-1 items-center gap-4">
                    <span
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-bold",
                        isActive ? "bg-brand text-white" : "bg-slate-100 text-slate-600"
                      )}
                    >
                      {(store.displayName ?? store.shopDomain).charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-ink">
                          {store.displayName ?? store.shopDomain}
                        </p>
                        <StatusPill status={store.status} />
                        {isActive ? (
                          <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                            Active
                          </span>
                        ) : null}
                      </div>
                      {store.displayName ? (
                        <p className="text-[11px] text-muted">{store.shopDomain}</p>
                      ) : null}
                      <p className="text-xs text-muted">
                        Installed {formatDate(store.installedAt)} · Last sync {formatDate(store.lastSyncAt)}
                      </p>
                      {store.scopes.length > 0 ? (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {store.scopes.slice(0, 5).map((scope) => (
                            <span
                              key={scope}
                              className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-muted"
                            >
                              {scope}
                            </span>
                          ))}
                          {store.scopes.length > 5 ? (
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-muted">
                              +{store.scopes.length - 5}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setEditing(store)}
                      className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-canvas"
                    >
                      Edit
                    </button>
                    {!isActive && !isUninstalled ? (
                      <button
                        onClick={() => setActive(store.id)}
                        disabled={busyId === store.id}
                        className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-60"
                      >
                        {busyId === store.id ? "Switching…" : "Make active"}
                      </button>
                    ) : null}
                    <a
                      href={`https://admin.shopify.com/store/${store.shopDomain.replace(/\.myshopify\.com$/, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-brand hover:bg-canvas"
                    >
                      Open admin ↗
                    </a>
                    {!isUninstalled ? (
                      <button
                        onClick={() => disconnect(store.id, store.shopDomain)}
                        disabled={busyId === store.id}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                      >
                        Disconnect
                      </button>
                    ) : null}
                    <button
                      onClick={() => hardDelete(store.id, store.shopDomain)}
                      disabled={busyId === store.id}
                      className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                    >
                      Delete forever
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <StoreEditModal
        store={editing}
        onClose={() => setEditing(null)}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}

function StatusPill({ status }: { status: StoreSummary["status"] }) {
  const tone =
    status === "active"
      ? "bg-emerald-50 text-emerald-700"
      : status === "uninstalled"
      ? "bg-slate-100 text-slate-700"
      : status === "error"
      ? "bg-rose-50 text-rose-700"
      : "bg-amber-50 text-amber-700";
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", tone)}>
      {status}
    </span>
  );
}
