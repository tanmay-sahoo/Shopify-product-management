"use client";

import { useEffect, useState } from "react";

import type { StoreSummary } from "@/lib/types";

type Props = {
  store: StoreSummary | null;
  onClose: () => void;
  onSaved: () => void;
};

export function StoreEditModal({ store, onClose, onSaved }: Props) {
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDisplayName(store?.displayName ?? "");
    setError("");
  }, [store]);

  if (!store) return null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!store) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/stores/${store.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(typeof body?.error === "string" ? body.error : "Failed to save store.");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-line bg-white shadow-panel"
      >
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Edit store</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">{store.shopDomain}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas disabled:opacity-50"
          >
            Close
          </button>
        </header>

        <div className="space-y-4 px-6 py-5">
          <label className="block">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Store name</span>
              <span className="text-[10px] text-muted">Shown in the sidebar switcher</span>
            </div>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
              placeholder="e.g. Brand A · EU production"
            />
          </label>
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line bg-canvas px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-2xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-canvas disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-2xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-panel hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </footer>
      </form>
    </div>
  );
}
