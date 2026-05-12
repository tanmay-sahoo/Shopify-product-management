"use client";

import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function CredentialModal({ open, onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  if (!open) return null;

  function reset() {
    setName("");
    setClientId("");
    setClientSecret("");
    setNotes("");
    setError("");
    setShowSecret(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, clientId, clientSecret, notes })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save credential.");
        return;
      }
      onSaved();
      reset();
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
        if (!busy) {
          reset();
          onClose();
        }
      }}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-line bg-white shadow-panel"
      >
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Save credential</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">New Shopify app credential</h3>
          </div>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={busy}
            className="rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas disabled:opacity-50"
          >
            Close
          </button>
        </header>

        <div className="space-y-4 px-6 py-5">
          <Field label="Display name" required>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
              placeholder="e.g. Brand A production app"
            />
          </Field>

          <Field label="Client ID" required>
            <input
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              required
              className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 font-mono text-xs outline-none focus:border-brand focus:bg-white"
              placeholder="1234567890abcdef…"
            />
          </Field>

          <Field label="Client Secret" required>
            <div className="relative">
              <input
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                type={showSecret ? "text" : "password"}
                required
                className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 pr-14 font-mono text-xs outline-none focus:border-brand focus:bg-white"
                placeholder="shpss_…"
              />
              <button
                type="button"
                onClick={() => setShowSecret((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted hover:bg-canvas"
              >
                {showSecret ? "Hide" : "Show"}
              </button>
            </div>
          </Field>

          <Field label="Notes" hint="Optional">
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
              placeholder="Which stores this app is for, expiry, owner, …"
            />
          </Field>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line bg-canvas px-6 py-4">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
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
            {busy ? "Saving..." : "Save credential"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
          {label}
          {required ? <span className="ml-1 text-rose-500">*</span> : null}
        </span>
        {hint ? <span className="text-[10px] text-muted">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}
