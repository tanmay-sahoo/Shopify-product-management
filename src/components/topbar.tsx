"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AutoSyncToggle } from "@/components/auto-sync-toggle";
import { StoreSwitcher } from "@/components/store-switcher";
import type { StoreSummary } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

type Props = {
  store: StoreSummary | null;
  stores: StoreSummary[];
};

export function Topbar({ store, stores }: Props) {
  const router = useRouter();
  const [syncMessage, setSyncMessage] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  async function handleSyncNow() {
    if (!store) return;
    setSyncMessage("Sync started...");
    try {
      const response = await fetch(`/api/stores/${store.id}/sync`, { method: "POST" });
      const payload = (await response.json()) as {
        success?: boolean;
        syncedProducts?: number;
        syncedVariants?: number;
        error?: string;
      };

      if (!response.ok || !payload.success) {
        setSyncMessage(payload.error ?? "Sync failed. Check credentials and try again.");
        return;
      }

      setSyncMessage(
        `Synced ${payload.syncedProducts ?? 0} products and ${payload.syncedVariants ?? 0} variants.`
      );
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setSyncMessage("Sync failed. Unable to reach the server.");
    }
  }

  if (!store) {
    return (
      <header className="flex flex-col gap-4 border-b border-line/60 bg-white/80 px-8 py-5 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <circle cx="12" cy="17" r="0.5" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">No Shopify store connected</p>
            <p className="text-xs text-muted">Connect your first store to start syncing products.</p>
          </div>
        </div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-panel hover:opacity-90"
        >
          Connect a store
        </Link>
      </header>
    );
  }

  const isActive = store.status === "active";

  return (
    <header className="flex flex-col gap-4 border-b border-line/60 bg-white/80 px-8 py-5 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-4">
        <StoreSwitcher current={store} stores={stores} />
        <div className="flex flex-col gap-1">
          <span
            className={cn(
              "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
              isActive ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isActive ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
              )}
            />
            {store.status}
          </span>
          <p className="text-xs text-muted">Last sync · {formatDate(store.lastSyncAt)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {syncMessage ? <p className="text-xs text-muted">{syncMessage}</p> : null}
        <AutoSyncToggle store={store} />
        <a
          href="/imports"
          className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-canvas"
        >
          Import
        </a>
        <button
          onClick={handleSyncNow}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-panel transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("h-4 w-4", isPending && "animate-spin")}>
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          {isPending ? "Syncing..." : "Sync now"}
        </button>
      </div>
    </header>
  );
}
