"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import type { SyncMode } from "@/lib/inventory-sync/types";

const SAMPLES: Record<SyncMode, string> = {
  mirror: `group_name,mode,source_variant_id,target_variant_id,sync_stock,sync_price,stock_buffer,price_multiplier
Mirror Group A,mirror,gid://shopify/ProductVariant/111,gid://shopify/ProductVariant/222,true,true,0,1
Mirror Group A,mirror,gid://shopify/ProductVariant/111,gid://shopify/ProductVariant/333,true,true,0,1`,
  shared_pool: `group_name,mode,variant_id,sync_stock,sync_price
Pool Group A,shared_pool,gid://shopify/ProductVariant/111,true,false
Pool Group A,shared_pool,gid://shopify/ProductVariant/222,true,false
Pool Group A,shared_pool,gid://shopify/ProductVariant/333,true,false`,
  bundle: `group_name,mode,combo_variant_id,component_variant_id,quantity_required
Bundle Group A,bundle,gid://shopify/ProductVariant/999,gid://shopify/ProductVariant/111,2
Bundle Group A,bundle,gid://shopify/ProductVariant/999,gid://shopify/ProductVariant/222,1`
};

type ParsedGroup = {
  rowNumbers: number[];
  name: string;
  mode: SyncMode;
  syncStock: boolean;
  syncPrice: boolean;
  items: Array<{ shopifyVariantId: string; role: string }>;
};
type Preview = { ok: boolean; dryRun?: boolean; parsed?: { groups: ParsedGroup[]; errors: Array<{ row: number; message: string }> } };

export function CsvImportPanel({ onImported }: { onImported: () => void }) {
  const [mode, setMode] = useState<SyncMode>("mirror");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState<string[] | null>(null);

  async function handlePreview() {
    setBusy(true);
    setPreview(null);
    setImported(null);
    try {
      const res = await fetch("/api/inventory-sync/csv-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, csv, dryRun: true })
      });
      const body = (await res.json()) as Preview;
      setPreview(body);
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    setBusy(true);
    setImported(null);
    try {
      const res = await fetch("/api/inventory-sync/csv-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, csv })
      });
      const body = await res.json();
      if (body.ok) {
        setImported((body.created ?? []).map((c: { name: string }) => c.name));
        setCsv("");
        setPreview(null);
        onImported();
      } else {
        setPreview({ ok: false, parsed: body.parsed });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-line/70 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Bulk import via CSV</h3>
          <p className="mt-1 text-xs text-muted">
            Choose a mode, paste the CSV, preview the parsed groups, then import. Errors are reported per row.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["mirror", "shared_pool", "bundle"] as SyncMode[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setPreview(null);
              }}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-semibold transition",
                mode === m ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-canvas"
              )}
            >
              {m === "mirror" ? "Mirror" : m === "shared_pool" ? "Shared Pool" : "Bundle"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">CSV</p>
          <button
            type="button"
            onClick={() => setCsv(SAMPLES[mode])}
            className="text-[11px] font-semibold text-brand hover:underline"
          >
            Insert sample
          </button>
        </div>
        <textarea
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          rows={10}
          className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs text-ink"
          placeholder="Paste CSV here…"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handlePreview}
          disabled={!csv || busy}
          className="rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-50"
        >
          Preview / dry-run
        </button>
        <button
          onClick={handleImport}
          disabled={!csv || busy}
          className="rounded-xl bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          Import groups
        </button>
        <a
          href={`/api/inventory-sync/csv-export?mode=${mode}`}
          className="ml-auto rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-canvas"
        >
          Export {mode.replace("_", " ")} CSV
        </a>
      </div>

      {preview?.parsed?.errors.length ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs font-semibold text-rose-800">
            {preview.parsed.errors.length} error{preview.parsed.errors.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-2 space-y-1 text-[11px] text-rose-800">
            {preview.parsed.errors.slice(0, 50).map((error, idx) => (
              <li key={idx}>
                row {error.row}: {error.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview?.parsed?.groups.length ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-semibold text-emerald-800">
            Parsed {preview.parsed.groups.length} group{preview.parsed.groups.length === 1 ? "" : "s"} ·{" "}
            {preview.parsed.errors.length === 0 ? "no errors" : "with errors"}
          </p>
          <ul className="mt-2 space-y-1 text-[11px] text-emerald-900">
            {preview.parsed.groups.map((group) => (
              <li key={group.name}>
                <strong>{group.name}</strong> ({group.mode}) · {group.items.length} item(s)
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {imported?.length ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-semibold text-emerald-800">
            Imported {imported.length} group{imported.length === 1 ? "" : "s"}: {imported.join(", ")}
          </p>
        </div>
      ) : null}
    </section>
  );
}
