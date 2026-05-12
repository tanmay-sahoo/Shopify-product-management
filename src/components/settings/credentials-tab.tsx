"use client";

import { useEffect, useState } from "react";

import { CredentialModal } from "@/components/settings/credential-modal";
import { formatDate } from "@/lib/utils";

type Credential = {
  id: number;
  name: string;
  clientId: string;
  notes: string | null;
  createdAt: string;
};

export function CredentialsTab() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/credentials");
      const body = await response.json();
      setCredentials(Array.isArray(body?.items) ? body.items : []);
    } catch {
      setCredentials([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function deleteCredential(id: number, name: string) {
    if (!confirm(`Delete saved credential "${name}"? Stores already connected with it keep working.`)) return;
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/credentials/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(typeof body?.error === "string" ? body.error : "Failed to delete credential.");
        return;
      }
      setCredentials((prev) => prev.filter((cred) => cred.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>
      ) : null}

      <section className="rounded-3xl border border-line bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-ink">Saved app credentials</h3>
            <p className="mt-0.5 text-xs text-muted">
              {credentials.length} saved · pick from these when connecting a new store
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-panel hover:opacity-90"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add credential
          </button>
        </div>

        {credentials.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted">
            No saved credentials yet. Click "Add credential" to save your first one.
          </div>
        ) : (
          <ul className="divide-y divide-line/70">
            {credentials.map((cred) => (
              <li
                key={cred.id}
                className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{cred.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted">{cred.clientId}</p>
                  {cred.notes ? (
                    <p className="mt-1 text-xs leading-5 text-muted">{cred.notes}</p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-muted">Added {formatDate(cred.createdAt)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => deleteCredential(cred.id, cred.name)}
                    disabled={busyId === cred.id}
                    className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <article className="rounded-3xl border border-line bg-white p-6 shadow-sm">
        <h4 className="text-base font-semibold text-ink">Where do these come from?</h4>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted">
          <li>Create a custom app in your Shopify Partners dashboard (or per-store via Apps → Develop apps).</li>
          <li>Copy the Client ID and Client Secret from the app's API credentials screen.</li>
          <li>Add them here with a friendly name (e.g. "Brand A production app").</li>
          <li>When connecting a store, pick the saved credential from the dropdown — no need to retype.</li>
        </ol>
        <p className="mt-4 rounded-2xl bg-canvas px-4 py-3 text-xs leading-5 text-muted">
          Client secrets are encrypted at rest with <code className="font-mono text-[11px]">TOKEN_ENCRYPTION_KEY</code> and never returned in API responses.
        </p>
      </article>

      <CredentialModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={load} />
    </div>
  );
}
