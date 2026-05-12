"use client";

import { useState } from "react";

import type { ProductStatus } from "@/lib/types";

type Action =
  | { type: "status"; status: ProductStatus }
  | { type: "vendor"; vendor: string }
  | { type: "productType"; productType: string }
  | { type: "addTags"; tags: string[] }
  | { type: "removeTags"; tags: string[] }
  | { type: "priceAdjust"; mode: "percent" | "fixed"; value: number }
  | { type: "delete" };

type Props = {
  selectedIds: number[];
  vendors: string[];
  productTypes: string[];
  onClear: () => void;
  onApplied: () => void;
};

const STATUSES: ProductStatus[] = ["active", "draft", "archived"];

export function BulkActionBar({ selectedIds, vendors, productTypes, onClear, onApplied }: Props) {
  const [action, setAction] = useState<string>("");
  const [statusValue, setStatusValue] = useState<ProductStatus>("active");
  const [vendorValue, setVendorValue] = useState("");
  const [typeValue, setTypeValue] = useState("");
  const [tagsValue, setTagsValue] = useState("");
  const [priceMode, setPriceMode] = useState<"percent" | "fixed">("percent");
  const [priceValue, setPriceValue] = useState("0");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (selectedIds.length === 0) return null;

  async function apply() {
    let payload: Action | null = null;
    switch (action) {
      case "status":
        payload = { type: "status", status: statusValue };
        break;
      case "vendor":
        if (!vendorValue.trim()) return;
        payload = { type: "vendor", vendor: vendorValue.trim() };
        break;
      case "productType":
        if (!typeValue.trim()) return;
        payload = { type: "productType", productType: typeValue.trim() };
        break;
      case "addTags":
      case "removeTags": {
        const tags = tagsValue
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
        if (tags.length === 0) return;
        payload = { type: action, tags };
        break;
      }
      case "priceAdjust": {
        const num = Number(priceValue);
        if (!Number.isFinite(num)) return;
        payload = { type: "priceAdjust", mode: priceMode, value: num };
        break;
      }
      case "delete":
        if (!confirm(`Delete ${selectedIds.length} products? This will create a draft delete change.`)) {
          return;
        }
        payload = { type: "delete" };
        break;
      default:
        return;
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/products/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, action: payload })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(typeof body?.error === "string" ? body.error : "Failed to queue action.");
        return;
      }
      setMessage(`Queued ${body.selectionCount ?? selectedIds.length} products as a draft change.`);
      onApplied();
    } catch {
      setMessage("Network error while queuing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sticky bottom-4 z-40 mx-auto mt-4 flex w-full max-w-5xl items-center gap-3 rounded-2xl border border-line bg-ink/95 px-5 py-3 text-white shadow-panel backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-ink">{selectedIds.length}</span>
        <span className="text-sm font-medium">selected</span>
      </div>

      <div className="ml-2 h-6 w-px bg-white/20" />

      <select
        value={action}
        onChange={(event) => {
          setAction(event.target.value);
          setMessage("");
        }}
        className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none [&>option]:text-ink"
      >
        <option value="">Choose action…</option>
        <option value="status">Change status</option>
        <option value="vendor">Set vendor</option>
        <option value="productType">Set custom type</option>
        <option value="addTags">Add tags</option>
        <option value="removeTags">Remove tags</option>
        <option value="priceAdjust">Adjust variant prices</option>
        <option value="delete">Delete</option>
      </select>

      {action === "status" ? (
        <select
          value={statusValue}
          onChange={(event) => setStatusValue(event.target.value as ProductStatus)}
          className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none [&>option]:text-ink"
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      ) : null}

      {action === "vendor" ? (
        <input
          list="bulk-vendor-options"
          value={vendorValue}
          onChange={(event) => setVendorValue(event.target.value)}
          className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
          placeholder="Vendor name"
        />
      ) : null}
      <datalist id="bulk-vendor-options">
        {vendors.map((vendor) => (
          <option key={vendor} value={vendor} />
        ))}
      </datalist>

      {action === "productType" ? (
        <input
          list="bulk-type-options"
          value={typeValue}
          onChange={(event) => setTypeValue(event.target.value)}
          className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
          placeholder="Custom type"
        />
      ) : null}
      <datalist id="bulk-type-options">
        {productTypes.map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>

      {action === "addTags" || action === "removeTags" ? (
        <input
          value={tagsValue}
          onChange={(event) => setTagsValue(event.target.value)}
          className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
          placeholder="tag1, tag2"
        />
      ) : null}

      {action === "priceAdjust" ? (
        <div className="flex items-center gap-2">
          <select
            value={priceMode}
            onChange={(event) => setPriceMode(event.target.value as "percent" | "fixed")}
            className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none [&>option]:text-ink"
          >
            <option value="percent">% change</option>
            <option value="fixed">+/- amount</option>
          </select>
          <input
            type="number"
            step="0.01"
            value={priceValue}
            onChange={(event) => setPriceValue(event.target.value)}
            className="w-24 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none"
            placeholder={priceMode === "percent" ? "10" : "5"}
          />
        </div>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        {message ? <span className="text-xs text-white/70">{message}</span> : null}
        <button
          onClick={apply}
          disabled={busy || !action}
          className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Queuing…" : "Apply"}
        </button>
        <button
          onClick={onClear}
          className="rounded-xl border border-white/20 px-3 py-2 text-sm font-medium text-white hover:bg-white/10"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
