"use client";

import { useRef, useState } from "react";

import { StatCard } from "@/components/stat-card";
import { cn } from "@/lib/utils";
import type { ImportSummary } from "@/lib/types";
import type { ParsedProduct } from "@/lib/import-parser";

type ParseResult = {
  fileName: string;
  totalProducts: number;
  totalVariants: number;
  totalImages: number;
  totalMetafields: number;
  errors: Array<{ row: number; message: string }>;
  products: ParsedProduct[];
};

type PushOutcome = {
  handle: string;
  ok: boolean;
  message: string;
  productId?: string | null;
  variantsCreated?: number;
  imagesCreated?: number;
  metafieldsSet?: number;
};

export function ImportUploader({ initial: _initial }: { initial: ImportSummary }) {
  void _initial;
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [pushResults, setPushResults] = useState<PushOutcome[] | null>(null);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    setPushResults(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/imports/upload", { method: "POST", body: formData });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.success) {
        setError(typeof body?.error === "string" ? body.error : "Upload failed.");
        setParsed(null);
        return;
      }
      const item = body.item as ParseResult;
      setParsed(item);
      setMessage(
        `Parsed ${item.totalProducts} product(s), ${item.totalVariants} variant(s), ${item.totalImages} image(s), ${item.totalMetafields} metafield(s).`
      );
    } catch {
      setError("Network error during upload.");
    } finally {
      setBusy(false);
    }
  }

  async function pushToShopify() {
    if (!parsed || parsed.products.length === 0) return;
    setPushing(true);
    setError("");
    setMessage("");
    setPushResults(null);
    try {
      const response = await fetch("/api/imports/push-to-shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: parsed.fileName, products: parsed.products })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === "string" ? body.error : "Push failed.");
        return;
      }
      setPushResults(body.outcomes as PushOutcome[]);
      const totals = body.totals as { ok: number; failed: number };
      setMessage(`Pushed ${totals.ok} product(s) to Shopify, ${totals.failed} failed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error while pushing.");
    } finally {
      setPushing(false);
    }
  }

  const productCount = parsed?.totalProducts ?? 0;
  const errorCount = parsed?.errors.length ?? 0;
  const variantCount = parsed?.totalVariants ?? 0;
  const metafieldCount = parsed?.totalMetafields ?? 0;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Products" value={productCount} helper={parsed?.fileName ?? "No file"} />
        <StatCard label="Variants" value={variantCount} helper="From CSV rows" tone="info" />
        <StatCard label="Metafields" value={metafieldCount} helper="Product + variant" tone="info" />
        <StatCard
          label="Parse errors"
          value={errorCount}
          helper="Rows skipped"
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
        <h4 className="mt-4 text-base font-semibold text-ink">Drop a Shopify-format CSV file here</h4>
        <p className="mt-1 text-sm text-muted">
          Standard Shopify columns (Handle, Title, Variant SKU, Image Src, Product Metafield: ns.key [type], …) are
          recognised. Files exported from this app round-trip end-to-end.
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
            {busy ? "Parsing..." : "Choose CSV"}
          </button>
          <button
            onClick={pushToShopify}
            disabled={pushing || !parsed || parsed.products.length === 0}
            className="rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white shadow-panel disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pushing ? "Pushing..." : `Push ${productCount} product(s) to Shopify`}
          </button>
        </div>
        {message ? <p className="mt-4 text-xs text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-4 text-xs text-rose-700">{error}</p> : null}
      </section>

      {parsed && parsed.errors.length > 0 ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-xs font-semibold text-rose-800">Parse errors</p>
          <ul className="mt-2 space-y-1 text-[11px] text-rose-800">
            {parsed.errors.slice(0, 30).map((err, idx) => (
              <li key={idx}>
                row {err.row}: {err.message}
              </li>
            ))}
            {parsed.errors.length > 30 ? <li>… and {parsed.errors.length - 30} more</li> : null}
          </ul>
        </section>
      ) : null}

      {parsed && parsed.products.length > 0 ? (
        <section className="rounded-2xl border border-line/70 bg-white shadow-sm">
          <div className="border-b border-line/70 bg-canvas/60 px-5 py-3 text-[11px] uppercase tracking-[0.18em] text-muted">
            Preview · {parsed.products.length} product{parsed.products.length === 1 ? "" : "s"}
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50/95 text-[11px] uppercase tracking-[0.14em] text-muted backdrop-blur">
                <tr>
                  <th className="px-4 py-3 font-semibold">Handle</th>
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">Vendor</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Variants</th>
                  <th className="px-4 py-3 font-semibold text-right">Images</th>
                  <th className="px-4 py-3 font-semibold text-right">Metafields</th>
                  <th className="px-4 py-3 font-semibold">Push result</th>
                </tr>
              </thead>
              <tbody>
                {parsed.products.map((product) => {
                  const result = pushResults?.find((r) => r.handle === product.handle);
                  const totalMf =
                    product.metafields.length + product.variants.reduce((acc, v) => acc + v.metafields.length, 0);
                  return (
                    <tr key={product.handle} className="border-t border-line/50 align-top">
                      <td className="px-4 py-3 font-mono text-xs">{product.handle}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-ink">{product.title || "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted">{product.vendor || "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted">{product.status}</td>
                      <td className="px-4 py-3 text-right text-xs">{product.variants.length}</td>
                      <td className="px-4 py-3 text-right text-xs">{product.images.length}</td>
                      <td className="px-4 py-3 text-right text-xs">{totalMf}</td>
                      <td className="px-4 py-3 text-xs">
                        {!result ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <span
                            className={cn(
                              "rounded-md px-2 py-0.5 text-[10px] font-semibold",
                              result.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                            )}
                          >
                            {result.ok ? "ok" : "failed"} · {result.message}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
