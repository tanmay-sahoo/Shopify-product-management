"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { StatCard } from "@/components/stat-card";
import { cn, formatDate } from "@/lib/utils";

type ParseResult = {
  importId: string;
  fileName: string;
  totalCollections: number;
  totalMetafields: number;
  errors: Array<{ row: number; message: string }>;
};

type ImportJob = {
  id: string;
  storeId: string;
  fileName: string | null;
  importType?: "products" | "collections";
  status: "uploaded" | "processing" | "pushing" | "completed" | "failed";
  phase: string;
  currentCount: number;
  totalRows: number;
  validRows: number;
  errorRows: number;
  message: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

// For collections imports, ImportRow.sku carries the Collection ID.
type ImportRowDetail = {
  rowNumber: number;
  handle: string | null;
  sku: string | null;
  title: string | null;
  pushStatus: "pending" | "ok" | "error";
  pushError: string | null;
};

function statusTone(status: ImportJob["status"]): string {
  switch (status) {
    case "completed":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "failed":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "pushing":
    case "processing":
      return "bg-sky-50 text-sky-700 border-sky-200";
    default:
      return "bg-slate-50 text-slate-700 border-line";
  }
}

function isRunning(job: ImportJob | null): boolean {
  return job?.status === "pushing" || job?.status === "processing";
}

export function CollectionImportPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [activeJob, setActiveJob] = useState<ImportJob | null>(null);
  const [activeRows, setActiveRows] = useState<ImportRowDetail[]>([]);
  const [history, setHistory] = useState<ImportJob[]>([]);

  const refreshActive = useCallback(async () => {
    try {
      const listRes = await fetch("/api/imports", { cache: "no-store" });
      if (!listRes.ok) return;
      const listPayload = (await listRes.json()) as { items?: ImportJob[] };
      // Only collection imports belong to this panel.
      const items = (listPayload.items ?? []).filter((it) => it.importType === "collections");
      setHistory(items);
      const latest = items[0] ?? null;
      if (!latest) {
        setActiveJob(null);
        setActiveRows([]);
        return;
      }
      const statusRes = await fetch(`/api/imports/${latest.id}/status`, { cache: "no-store" });
      if (!statusRes.ok) return;
      const statusPayload = (await statusRes.json()) as { job: ImportJob | null; rows?: ImportRowDetail[] };
      setActiveJob(statusPayload.job);
      setActiveRows(statusPayload.rows ?? []);
    } catch {
      // ignore — next tick retries
    }
  }, []);

  useEffect(() => {
    void refreshActive();
    const interval = setInterval(() => void refreshActive(), 2_000);
    return () => clearInterval(interval);
  }, [refreshActive]);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/collections/upload", { method: "POST", body: formData });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.success) {
        setError(typeof body?.error === "string" ? body.error : "Upload failed.");
        setParsed(null);
        return;
      }
      const item = body.item as ParseResult;
      setParsed(item);
      setMessage(
        `Parsed ${item.totalCollections} collection(s), ${item.totalMetafields} metafield(s). Saved as import #${item.importId}.`
      );
      void refreshActive();
    } catch {
      setError("Network error during upload.");
    } finally {
      setBusy(false);
    }
  }

  async function pushToShopify() {
    if (!parsed) return;
    setPushing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/imports/${parsed.importId}/push`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === "string" ? body.error : "Push failed.");
        return;
      }
      setMessage(
        body.alreadyRunning
          ? "An import is already running for this store. Watch progress above."
          : "Push started. Progress is shown above and survives page reloads."
      );
      void refreshActive();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error while pushing.");
    } finally {
      setPushing(false);
    }
  }

  async function cancelImport(id: string) {
    try {
      await fetch(`/api/imports/${id}/cancel`, { method: "POST" });
      void refreshActive();
    } catch {
      // ignore
    }
  }

  const collectionCount = parsed?.totalCollections ?? 0;
  const metafieldCount = parsed?.totalMetafields ?? 0;
  const errorCount = parsed?.errors.length ?? 0;
  const running = isRunning(activeJob);
  const showActiveCard = Boolean(activeJob) && (running || activeJob?.status === "uploaded");
  const progressPct =
    activeJob && activeJob.totalRows > 0
      ? Math.min(100, Math.round((activeJob.currentCount / activeJob.totalRows) * 100))
      : 0;

  return (
    <div className="space-y-6">
      <p className="rounded-2xl border border-line/70 bg-slate-50/60 px-4 py-3 text-xs leading-5 text-muted">
        Partial-update collections by <span className="font-semibold">ID</span>. Only the columns you include change;
        empty cells are left alone. Smart-collection rules are never modified. Tip: export from the Collections page,
        edit, then upload here. Run a store sync afterward to refresh the Collections view.
      </p>

      {showActiveCard && activeJob ? (
        <section className={cn("rounded-3xl border bg-white p-5 shadow-sm", statusTone(activeJob.status))}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">
                Collections import #{activeJob.id} · {activeJob.fileName ?? "upload.csv"}
              </p>
              <p className="mt-1 text-sm font-semibold">{activeJob.message ?? activeJob.status}</p>
              <p className="mt-1 text-xs opacity-80">
                Started {formatDate(activeJob.createdAt)}
                {activeJob.finishedAt ? ` · Finished ${formatDate(activeJob.finishedAt)}` : ""}
              </p>
            </div>
            {running ? (
              <button
                onClick={() => void cancelImport(activeJob.id)}
                className="rounded-xl border border-current px-3 py-1.5 text-xs font-semibold hover:bg-white/40"
              >
                Cancel
              </button>
            ) : null}
          </div>
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/40">
              <div className="h-full bg-current opacity-70 transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="mt-2 text-xs">
              {activeJob.currentCount} / {activeJob.totalRows} · {activeJob.validRows} ok · {activeJob.errorRows} failed
            </p>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label="Collections" value={collectionCount} helper={parsed?.fileName ?? "No file"} tone="info" />
        <StatCard label="Metafields" value={metafieldCount} helper="From CSV columns" tone="info" />
        <StatCard
          label="Skipped rows"
          value={errorCount}
          helper="No ID / no fields"
          tone={errorCount > 0 ? "danger" : "success"}
        />
      </section>

      <section
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          handleFiles(event.dataTransfer.files);
        }}
        className="rounded-3xl border border-dashed border-line bg-white p-8 text-center shadow-sm"
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brandSoft text-brand">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <h4 className="mt-4 text-base font-semibold text-ink">Drop a collections CSV here</h4>
        <p className="mt-1 text-sm text-muted">
          Required column: <span className="font-mono">ID</span>. Optional: Title, Body (HTML), Handle, Sort Order,
          Template Suffix, SEO Title/Description, and <span className="font-mono">Collection Metafield: ns.key [type]</span>.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => handleFiles(event.target.files)}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy || running}
            className="rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-panel disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Parsing..." : "Choose CSV"}
          </button>
          <button
            onClick={pushToShopify}
            disabled={pushing || running || !parsed || parsed.totalCollections === 0}
            className="rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white shadow-panel disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pushing ? "Starting..." : `Push ${collectionCount} collection(s) to Shopify`}
          </button>
        </div>
        {message ? <p className="mt-4 text-xs text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-4 text-xs text-rose-700">{error}</p> : null}
      </section>

      {parsed && parsed.errors.length > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold text-amber-800">Skipped rows</p>
          <ul className="mt-2 space-y-1 text-[11px] text-amber-800">
            {parsed.errors.slice(0, 30).map((err, idx) => (
              <li key={idx}>
                row {err.row}: {err.message}
              </li>
            ))}
            {parsed.errors.length > 30 ? <li>… and {parsed.errors.length - 30} more</li> : null}
          </ul>
        </section>
      ) : null}

      {showActiveCard && activeJob && activeRows.length > 0 ? (
        <section className="rounded-2xl border border-line/70 bg-white shadow-sm">
          <div className="border-b border-line/70 bg-canvas/60 px-5 py-3 text-[11px] uppercase tracking-[0.18em] text-muted">
            Per-collection status · import #{activeJob.id}
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50/95 text-[11px] uppercase tracking-[0.14em] text-muted backdrop-blur">
                <tr>
                  <th className="px-4 py-3 font-semibold">#</th>
                  <th className="px-4 py-3 font-semibold">ID</th>
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">Handle</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Error</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((row) => (
                  <tr key={row.rowNumber} className="border-t border-line/50 align-top">
                    <td className="px-4 py-3 font-mono text-xs">{row.rowNumber}</td>
                    <td className="px-4 py-3 font-mono text-xs">{row.sku ?? "—"}</td>
                    <td className="px-4 py-3 text-sm">{row.title ?? "—"}</td>
                    <td className="px-4 py-3 text-xs">{row.handle ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 text-[10px] font-semibold",
                          row.pushStatus === "ok"
                            ? "bg-emerald-50 text-emerald-700"
                            : row.pushStatus === "error"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-slate-100 text-slate-600"
                        )}
                      >
                        {row.pushStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-rose-700">{row.pushError ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {history.length > 0 ? (
        <section className="rounded-2xl border border-line/70 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 bg-canvas/60 px-5 py-3 text-[11px] uppercase tracking-[0.18em] text-muted">
            <span>Recent collection imports</span>
            <span className="normal-case tracking-normal text-[11px]">Records older than 7 days are removed automatically.</span>
          </div>
          <div className="divide-y divide-line/70">
            {history.map((job) => (
              <div key={job.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className={cn("rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase", statusTone(job.status))}>
                  {job.status}
                </span>
                <span className="text-sm font-semibold text-ink">{job.fileName ?? "upload.csv"}</span>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-muted">Batch&nbsp;#{job.id}</span>
                <span className="text-xs text-muted">{formatDate(job.createdAt)}</span>
                <span className="ml-auto flex items-center gap-2 text-xs">
                  <span className="text-muted">
                    {job.validRows} ok · {job.errorRows} failed · {job.totalRows} total
                  </span>
                  {job.validRows > 0 ? (
                    <a
                      href={`/api/imports/${job.id}/success.csv`}
                      className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      Success CSV
                    </a>
                  ) : null}
                  {job.errorRows > 0 ? (
                    <a
                      href={`/api/imports/${job.id}/errors.csv`}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      Errors CSV
                    </a>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
