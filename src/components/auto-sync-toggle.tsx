"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type { StoreSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "lns_auto_sync";

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

  useEffect(() => {
    setSettings(readSettings());
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  }, [settings]);

  const runSync = useMemo(
    () =>
      async () => {
        if (!store?.id || running) return;
        setRunning(true);
        try {
          const response = await fetch(`/api/stores/${store.id}/sync`, { method: "POST" });
          if (response.ok) {
            setLastRun(Date.now());
            router.refresh();
          }
        } finally {
          setRunning(false);
        }
      },
    [router, running, store?.id]
  );

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!settings.enabled) return;
    const ms = settings.intervalMin * 60 * 1000;
    intervalRef.current = setInterval(runSync, ms);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [settings.enabled, settings.intervalMin, runSync]);

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
            settings.enabled ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
          )}
        />
        Auto-sync {settings.enabled ? `· ${settings.intervalMin}m` : "off"}
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-72 rounded-2xl border border-line bg-white p-4 shadow-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Auto-sync</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            Re-pull this store's products on an interval. Set to off to sync manually.
          </p>

          <label className="mt-4 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Enable</span>
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
            onClick={runSync}
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
            Production tip: register Shopify webhooks for `products/update` and `inventory_levels/update`
            to get push-based updates without polling.
          </p>
        </div>
      ) : null}
    </div>
  );
}
