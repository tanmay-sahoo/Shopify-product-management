"use client";

import { useRef, useState } from "react";

type Outcome = { id: string; title: string; ok: boolean; message: string };
type ParseError = { row: number; message: string };
type ImportResult = {
  success: boolean;
  fileName: string;
  totals: { ok: number; failed: number; skipped: number };
  parseErrors: ParseError[];
  outcomes: Outcome[];
};

export function CollectionImportPanel() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/collections/import", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok || payload?.error) {
        setError(payload?.error ?? "Import failed");
        return;
      }
      setResult(payload as ImportResult);
    } catch {
      setError("Unable to reach the server");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const failedOutcomes = result?.outcomes.filter((o) => !o.ok) ?? [];

  return (
    <section className="rounded-3xl border border-line/80 bg-white/70 p-5 shadow-panel backdrop-blur">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Bulk update collections</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
            Upload a CSV keyed by <span className="font-semibold">ID</span> to partial-update collection fields and
            metafields. Only the columns you include are changed; empty cells are left alone. Smart-collection rules are
            never modified. Tip: export first, edit, then re-import. Changes push to Shopify — run a sync to refresh this
            view.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-panel transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Importing…" : "Import CSV"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      ) : null}

      {result ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">{result.totals.ok} updated</span>
            <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-700">{result.totals.failed} failed</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{result.totals.skipped} skipped</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{result.fileName}</span>
          </div>

          {result.parseErrors.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              <p className="mb-1 font-semibold">Skipped rows</p>
              <ul className="space-y-0.5">
                {result.parseErrors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
                {result.parseErrors.length > 20 ? <li>…and {result.parseErrors.length - 20} more</li> : null}
              </ul>
            </div>
          ) : null}

          {failedOutcomes.length > 0 ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
              <p className="mb-1 font-semibold">Failed updates</p>
              <ul className="space-y-0.5">
                {failedOutcomes.slice(0, 20).map((o, i) => (
                  <li key={i}>
                    <span className="font-medium">{o.title || o.id}</span>: {o.message}
                  </li>
                ))}
                {failedOutcomes.length > 20 ? <li>…and {failedOutcomes.length - 20} more</li> : null}
              </ul>
            </div>
          ) : null}

          {result.totals.failed === 0 && result.totals.ok > 0 ? (
            <p className="text-xs text-emerald-700">
              All updates pushed to Shopify. Run a sync to refresh the collections shown here.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
