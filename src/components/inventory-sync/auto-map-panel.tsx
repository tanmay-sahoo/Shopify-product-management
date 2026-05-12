"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type Strategy = "sku" | "tag" | "title";

type Suggestion = {
  reason: Strategy;
  key: string;
  label: string;
  members: Array<{ shopifyVariantId: string; sku: string | null; title: string | null; productTitle: string | null }>;
};

const LABELS: Record<Strategy, { label: string; help: string }> = {
  sku: { label: "By SKU", help: "Variants that share the same SKU are usually intended to mirror or share stock." },
  tag: { label: "By tag", help: "Products with the same tag are often candidates for a shared pool." },
  title: { label: "By title", help: "Products with overlapping title tokens — review carefully." }
};

export function AutoMapPanel({ onCreated }: { onCreated: () => void }) {
  const [strategy, setStrategy] = useState<Strategy>("sku");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [chosenMode, setChosenMode] = useState<Record<string, "mirror" | "shared_pool">>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [created, setCreated] = useState<string[]>([]);

  async function loadSuggestions(next: Strategy) {
    setStrategy(next);
    setLoading(true);
    setSuggestions([]);
    setCreated([]);
    try {
      const res = await fetch(`/api/inventory-sync/auto-map?by=${next}`);
      const body = await res.json();
      if (body.ok) setSuggestions(body.suggestions);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSuggestions("sku");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createFromSuggestion(suggestion: Suggestion) {
    const mode = chosenMode[suggestion.key] ?? (suggestion.reason === "sku" ? "mirror" : "shared_pool");
    const name = `Auto-${suggestion.reason}: ${suggestion.label}`.slice(0, 240);

    let items;
    if (mode === "mirror") {
      const [source, ...targets] = suggestion.members;
      items = [
        { shopifyVariantId: source.shopifyVariantId, role: "source" as const },
        ...targets.map((m) => ({ shopifyVariantId: m.shopifyVariantId, role: "target" as const, stockBuffer: 0, priceMultiplier: 1 }))
      ];
    } else {
      items = suggestion.members.map((m) => ({ shopifyVariantId: m.shopifyVariantId, role: "member" as const }));
    }

    setBusyKey(suggestion.key);
    try {
      const res = await fetch("/api/inventory-sync/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          mode,
          syncStock: true,
          syncPrice: false,
          active: true,
          items
        })
      });
      const body = await res.json();
      if (body.ok) {
        setCreated((prev) => [...prev, name]);
        onCreated();
      }
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-line/70 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Auto-map suggestions</h3>
          <p className="mt-1 text-xs text-muted">{LABELS[strategy].help}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["sku", "tag", "title"] as Strategy[]).map((s) => (
            <button
              key={s}
              onClick={() => loadSuggestions(s)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-semibold transition",
                strategy === s ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-canvas"
              )}
            >
              {LABELS[s].label}
            </button>
          ))}
        </div>
      </div>

      {loading ? <p className="text-xs text-muted">Loading suggestions…</p> : null}
      {!loading && suggestions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-canvas/40 px-3 py-6 text-center text-xs text-muted">
          No suggestions yet. Choose a strategy above to scan your synced catalog.
        </p>
      ) : null}

      {suggestions.length ? (
        <ul className="divide-y divide-line/60 rounded-xl border border-line/60">
          {suggestions.map((suggestion) => {
            const mode = chosenMode[suggestion.key] ?? (suggestion.reason === "sku" ? "mirror" : "shared_pool");
            return (
              <li key={suggestion.key} className="px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-ink">{suggestion.label}</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {suggestion.members.length} variants ·{" "}
                      {suggestion.members
                        .slice(0, 3)
                        .map((m) => m.productTitle ?? m.sku ?? m.shopifyVariantId)
                        .join(", ")}
                      {suggestion.members.length > 3 ? `, +${suggestion.members.length - 3} more` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      value={mode}
                      onChange={(event) =>
                        setChosenMode((prev) => ({ ...prev, [suggestion.key]: event.target.value as "mirror" | "shared_pool" }))
                      }
                      className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-medium text-ink"
                    >
                      <option value="mirror">Mirror</option>
                      <option value="shared_pool">Shared pool</option>
                    </select>
                    <button
                      onClick={() => createFromSuggestion(suggestion)}
                      disabled={busyKey === suggestion.key}
                      className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {busyKey === suggestion.key ? "…" : "Create group"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {created.length ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Created {created.length} group{created.length === 1 ? "" : "s"}: {created.join(", ")}
        </p>
      ) : null}
    </section>
  );
}
