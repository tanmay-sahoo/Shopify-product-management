"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { StoreSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "lns_auto_sync";
const SMART_SYNC_STALE_MIN = 10;

type Settings = {
  enabled: boolean;
  intervalMin: number;
};

const INTERVAL_OPTIONS = [5, 15, 30, 60];

function readSettings(): Settings {
  if (typeof window === "undefined") return { enabled: false, intervalMin: 15 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: false, intervalMin: 15 };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      enabled: Boolean(parsed.enabled),
      intervalMin: INTERVAL_OPTIONS.includes(parsed.intervalMin ?? 0) ? parsed.intervalMin! : 15
    };
  } catch {
    return { enabled: false, intervalMin: 15 };
  }
}

export function AutoSyncToggle({ store }: { store: StoreSummary }) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>({ enabled: false, intervalMin: 15 });
  const [open, setOpen] = useState(false);
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRunRef = useRef<number>(0);

  useEffect(() => {
    setSettings(readSettings());
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  }, [settings]);

  const runSync = useCallback(
    async (reason: "manual" | "interval" | "smart" = "manual") => {
      if (!store?.id) return;
      if (Date.now() - lastRunRef.current < 5_000) return;
      lastRunRef.current = Date.now();
      setRunning(true);
      try {
        const response = await fetch(`/api/stores/${store.id}/sync`, { method: "POST" });
        if (response.ok) {
          setLastRun(Date.now());
          router.refresh();
        }
      } catch {
        // ignore — surfaces in sync logs
      } finally {
        setRunning(false);
        void reason;
      }
    },
    [router, store?.id]
  );

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!settings.enabled) return;
    const ms = settings.intervalMin * 60 * 1000;
    intervalRef.current = setInterval(() => runSync("interval"), ms);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [settings.enabled, settings.intervalMin, runSync]);

  const lastSyncMs = useMemo(() => {
    if (!store?.lastSyncAt) return null;
    const ms = new Date(store.lastSyncAt).getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }, [store?.lastSyncAt]);

  const isStale = useMemo(() => {
    if (!lastSyncMs) return true;
    return Date.now() - lastSyncMs > SMART_SYNC_STALE_MIN * 60 * 1000;
  }, [lastSyncMs]);

  useEffect(() => {
    if (!store?.id) return;
    if (isStale && !running) {
      void runSync("smart");
    }
  }, [store?.id, isStale, running, runSync]);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      if (!store?.id) return;
      if (Date.now() - lastRunRef.current < 30_000) return;
      const last = lastSyncMs ?? 0;
      if (Date.now() - last > SMART_SYNC_STALE_MIN * 60 * 1000) {
        void runSync("smart");
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [lastSyncMs, runSync, store?.id]);

  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition",
          settings.enabled
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-line bg-white text-ink hover:bg-canvas"
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            running
              ? "bg-brand animate-pulse"
              : settings.enabled
              ? "bg-emerald-500 animate-pulse"
              : "bg-slate-400"
          )}
        />
        {running ? "Syncing…" : `Auto-sync ${settings.enabled ? `· ${settings.intervalMin}m` : "off"}`}
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-2xl border border-line bg-white p-4 shadow-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Auto-sync</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            Background sync runs when the data is older than {SMART_SYNC_STALE_MIN} min and you focus this tab. Enable
            the periodic toggle for fixed-interval polling on top of that.
          </p>

          <label className="mt-4 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Periodic sync</span>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, enabled: event.target.checked }))
              }
              className="h-5 w-9 cursor-pointer appearance-none rounded-full bg-slate-200 transition checked:bg-emerald-500"
            />
          </label>

          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Interval</p>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {INTERVAL_OPTIONS.map((min) => (
                <button
                  key={min}
                  onClick={() => setSettings((prev) => ({ ...prev, intervalMin: min }))}
                  className={cn(
                    "rounded-lg border px-2 py-1.5 text-xs font-semibold transition",
                    settings.intervalMin === min
                      ? "border-brand bg-brand text-white"
                      : "border-line bg-canvas text-muted hover:bg-white"
                  )}
                >
                  {min}m
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => void runSync("manual")}
            disabled={running}
            className="mt-4 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-xs font-semibold text-ink hover:bg-white disabled:opacity-50"
          >
            {running ? "Syncing..." : "Sync now"}
          </button>

          {lastRun ? (
            <p className="mt-2 text-[11px] text-muted">
              Last auto-sync · {new Date(lastRun).toLocaleTimeString()}
            </p>
          ) : null}

          <p className="mt-3 rounded-xl bg-canvas px-3 py-2 text-[11px] leading-5 text-muted">
            For real push-based updates from Shopify, register webhooks (this app exposes a handler at
            <code className="mx-1 font-mono">/api/webhooks/shopify/products</code>) — they need a public URL,
            so set up ngrok or deploy first.
          </p>
        </div>
      ) : null}
    </div>
  );
}
