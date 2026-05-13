"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { AutoSyncToggle } from "@/components/auto-sync-toggle";
import { StoreSwitcher } from "@/components/store-switcher";
import type { StoreSummary } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

type Props = {
  store: StoreSummary | null;
  stores: StoreSummary[];
};

type SyncJob = {
  id: string;
  storeId: string;
  status: "queued" | "running" | "success" | "failed";
  phase: string;
  currentCount: number;
  totalCount: number | null;
  message: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

function progressLabel(job: SyncJob): string {
  if (job.status === "queued") return "Queued…";
  if (job.status === "failed") return job.message ?? "Sync failed";
  if (job.status === "success") return job.message ?? "Sync complete";
  // running
  const total = job.totalCount;
  if (job.phase === "fetching") {
    return total ? `Fetching ${job.currentCount}/${total}` : `Fetching ${job.currentCount} products…`;
  }
  if (job.phase === "metafields") {
    return total ? `Metafields ${job.currentCount}/${total}` : `Fetching metafields…`;
  }
  if (job.phase === "cleanup") return "Cleaning up…";
  return job.message ?? "Syncing…";
}

export function Topbar({ store, stores }: Props) {
  const router = useRouter();
  const [job, setJob] = useState<SyncJob | null>(null);
  const [isPending, startTransition] = useTransition();
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTerminalIdRef = useRef<string | null>(null);

  const isRunning = job?.status === "queued" || job?.status === "running";

  useEffect(() => {
    if (!store) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/stores/${store.id}/sync/status`, { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json()) as { job: SyncJob | null };
        if (cancelled) return;
        const next = payload.job;
        setJob(next);
        if (next && (next.status === "success" || next.status === "failed")) {
          // Refresh the page once when a job transitions to a terminal state so
          // newly synced products show up without a manual reload.
          if (lastTerminalIdRef.current !== next.id) {
            lastTerminalIdRef.current = next.id;
            startTransition(() => router.refresh());
          }
        }
      } catch {
        // ignore transient errors
      }
    };

    tick();
    const interval = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [store, router]);

  async function handleCancel() {
    if (!store) return;
    try {
      await fetch(`/api/stores/${store.id}/sync/cancel`, { method: "POST" });
      setJob((prev) => (prev ? { ...prev, status: "failed", message: "Cancelled" } : prev));
    } catch {
      // ignore — next status poll will surface the real state
    }
  }

  async function handleSyncNow() {
    if (!store) return;
    if (isRunning) return;
    setJob((prev) => (prev ? { ...prev, status: "queued", message: "Queued…" } : prev));
    try {
      const response = await fetch(`/api/stores/${store.id}/sync`, { method: "POST" });
      const payload = (await response.json()) as { success?: boolean; job?: SyncJob; error?: string };
      if (!response.ok || !payload.success) {
        setJob(
          (prev) =>
            ({
              ...(prev ?? ({} as SyncJob)),
              status: "failed",
              message: payload.error ?? "Sync failed"
            }) as SyncJob
        );
        return;
      }
      if (payload.job) setJob(payload.job);
    } catch {
      setJob(
        (prev) =>
          ({
            ...(prev ?? ({} as SyncJob)),
            status: "failed",
            message: "Unable to reach the server"
          }) as SyncJob
      );
    }
  }

  if (!store) {
    return (
      <header className="relative z-30 flex flex-col gap-4 border-b border-line/60 bg-white/80 px-8 py-5 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
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
    <header className="relative z-30 flex flex-col gap-4 border-b border-line/60 bg-white/80 px-8 py-5 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
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
        {job && (job.status !== "success" || isPending) ? (
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
              job.status === "failed"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : isRunning
                  ? "border-sky-200 bg-sky-50 text-sky-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
            )}
          >
            {isRunning ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 animate-spin">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            ) : null}
            {progressLabel(job)}
            {isRunning ? (
              <button
                type="button"
                onClick={handleCancel}
                className="ml-1 rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-700 transition hover:bg-white"
                title="Cancel sync"
              >
                Cancel
              </button>
            ) : null}
          </span>
        ) : null}
        <AutoSyncToggle store={store} />
        <a
          href="/imports"
          className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-canvas"
        >
          Import
        </a>
        <button
          onClick={handleSyncNow}
          disabled={isRunning}
          className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-panel transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("h-4 w-4", isRunning && "animate-spin")}>
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          {isRunning ? "Syncing…" : "Sync now"}
        </button>
      </div>
    </header>
  );
}
