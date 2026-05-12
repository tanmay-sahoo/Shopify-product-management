"use client";

import { useRef, useState } from "react";

import { ImportPreviewTable } from "@/components/import-preview-table";
import { StatCard } from "@/components/stat-card";
import type { ImportSummary } from "@/lib/types";

export function ImportUploader({ initial }: { initial: ImportSummary }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [summary, setSummary] = useState<ImportSummary>(initial);
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/imports/upload", {
        method: "POST",
        body: formData
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.success) {
        setError(typeof body?.error === "string" ? body.error : "Upload failed.");
        return;
      }
      const item = body.item;
      setSummary({
        id: Date.now(),
        fileName: item.fileName ?? file.name,
        status: "validated",
        totalRows: item.totalRows ?? 0,
        validRows: item.validRows ?? 0,
        errorRows: item.errorRows ?? 0,
        warningRows: item.warningRows ?? 0,
        createdAt: new Date().toISOString(),
        rows: item.rows ?? []
      });
      setMessage(`Validated ${item.totalRows ?? 0} rows.`);
    } catch {
      setError("Network error during upload.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadErrorReport() {
    const errors = summary.rows.filter((row) => row.validationStatus === "error");
    if (errors.length === 0) {
      setMessage("No errored rows to download.");
      return;
    }
    const lines = [
      ["Row", "Handle", "SKU", "Errors"].join(","),
      ...errors.map((row) =>
        [row.rowNumber, row.handle, row.sku, `"${row.validationErrors.join("; ")}"`].join(",")
      )
    ].join("\n");
    const blob = new Blob([lines], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${summary.fileName.replace(/\.[^.]+$/, "")}-errors.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function pushApproved() {
    const valid = summary.rows.filter((row) => row.validationStatus === "valid");
    if (valid.length === 0) {
      setError("No valid rows to push.");
      return;
    }
    setPushing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: summary.fileName, rows: valid })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === "string" ? body.error : "Push failed.");
        return;
      }
      setMessage(`Queued ${valid.length} rows as draft changes.`);
    } catch {
      setError("Network error while pushing.");
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Rows" value={summary.totalRows} helper={summary.fileName || "No file"} />
        <StatCard label="Valid" value={summary.validRows} helper="Ready to push" tone="success" />
        <StatCard label="Warnings" value={summary.warningRows} helper="Non-blocking" tone="warning" />
        <StatCard label="Errors" value={summary.errorRows} helper="Blocked" tone="danger" />
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
        <h4 className="mt-4 text-base font-semibold text-ink">Drop a CSV file here</h4>
        <p className="mt-1 text-sm text-muted">
          Or click to choose a file. Horizontal Image 1, Image 2, … columns are read left to right.
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
            disabled={busy}
            className="rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-panel disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Validating..." : "Choose CSV"}
          </button>
          <button
            onClick={downloadErrorReport}
            disabled={summary.errorRows === 0}
            className="rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download error report
          </button>
          <button
            onClick={pushApproved}
            disabled={pushing || summary.validRows === 0}
            className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pushing ? "Pushing..." : `Push ${summary.validRows} valid rows as draft`}
          </button>
        </div>
        {message ? <p className="mt-4 text-xs text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-4 text-xs text-rose-700">{error}</p> : null}
      </section>

      <ImportPreviewTable summary={summary} />
    </div>
  );
}
