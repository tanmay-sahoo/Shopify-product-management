"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const OPTIONS: Array<{ value: number; label: string; helper: string }> = [
  { value: 0, label: "Off", helper: "No automatic refresh. Use the Sync button or webhooks." },
  { value: 1, label: "Every 1 hour", helper: "Fastest auto-refresh. Heaviest on Shopify rate limits." },
  { value: 2, label: "Every 2 hours", helper: "Recommended default for active catalogs." },
  { value: 6, label: "Every 6 hours", helper: "Good for stable catalogs that change a few times a day." },
  { value: 12, label: "Every 12 hours", helper: "Twice-daily refresh." },
  { value: 24, label: "Every 24 hours", helper: "Lightweight, once per day." }
];

export function SyncTab() {
  const [intervalHours, setIntervalHours] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/smart-sync", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load setting");
        const payload = (await res.json()) as { intervalHours: number };
        if (!cancelled) setIntervalHours(payload.intervalHours);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load setting");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/smart-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervalHours: next })
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to save");
      }
      const payload = (await res.json()) as { intervalHours: number };
      setIntervalHours(payload.intervalHours);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border border-line bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-1 border-b border-line/70 pb-4">
          <h2 className="text-base font-semibold text-ink">Auto-refresh all stores</h2>
          <p className="text-sm text-muted">
            Periodically pulls catalog changes from Shopify for every connected store. Webhooks already handle real-time
            edits — this is a safety net to keep all stores in step even if a webhook is missed. Applies to every store
            you have connected.
          </p>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-muted">Loading…</p>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {OPTIONS.map((option) => {
              const isActive = intervalHours === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={saving}
                  onClick={() => void save(option.value)}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                    isActive
                      ? "border-brand bg-brand/5 ring-1 ring-brand"
                      : "border-line bg-white hover:border-ink/40 hover:bg-canvas"
                  )}
                >
                  <p className="text-sm font-semibold text-ink">{option.label}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">{option.helper}</p>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 text-xs">
          {error ? <span className="text-rose-700">{error}</span> : null}
          {savedAt ? <span className="text-emerald-700">Saved.</span> : null}
          {saving ? <span className="text-muted">Saving…</span> : null}
        </div>
      </div>

      <div className="rounded-3xl border border-line bg-canvas p-4 text-xs leading-5 text-muted">
        <strong className="text-ink">How it runs:</strong> A scheduler inside the Node server ticks every 5 minutes and
        kicks off a background sync for any store whose last refresh is older than the interval above. It keeps running
        whether or not anyone has the browser open, and it dedupes — overlapping syncs for the same store are skipped.
        For serverless deployments (e.g. Vercel), point an external cron at
        <code className="mx-1 font-mono">POST /api/cron/smart-sync</code> (protect it with
        <code className="mx-1 font-mono">CRON_SECRET</code>) since long-running in-process timers aren&apos;t reliable
        on per-request runtimes.
      </div>
    </section>
  );
}
