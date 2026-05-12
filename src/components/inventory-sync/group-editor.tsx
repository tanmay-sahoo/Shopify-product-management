"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { ItemRole, SyncGroupWithItems, SyncMode } from "@/lib/inventory-sync/types";

import { VariantPicker, type VariantOption } from "./variant-picker";

type DraftItem = {
  shopifyVariantId: string;
  inventoryItemId: string | null;
  productLabel: string;
  variantLabel: string;
  role: ItemRole;
  quantityRequired: number;
  stockBuffer: number;
  priceMultiplier: number;
  syncStock: boolean;
  syncPrice: boolean;
};

function fromVariantOption(option: VariantOption, role: ItemRole): DraftItem {
  return {
    shopifyVariantId: option.shopifyVariantId,
    inventoryItemId: option.inventoryItemId,
    productLabel: option.productTitle ?? "(untitled)",
    variantLabel:
      [option.option1, option.option2, option.option3].filter(Boolean).join(" · ") || option.title || option.sku || "—",
    role,
    quantityRequired: 1,
    stockBuffer: 0,
    priceMultiplier: 1,
    syncStock: true,
    syncPrice: false
  };
}

function fromExisting(item: SyncGroupWithItems["items"][number]): DraftItem {
  return {
    shopifyVariantId: item.shopifyVariantId,
    inventoryItemId: item.inventoryItemId,
    productLabel: item.shopifyProductId ?? item.shopifyVariantId,
    variantLabel: item.shopifyVariantId,
    role: item.role,
    quantityRequired: item.quantityRequired,
    stockBuffer: item.stockBuffer,
    priceMultiplier: item.priceMultiplier,
    syncStock: item.syncStock,
    syncPrice: item.syncPrice
  };
}

export function GroupEditor({
  group,
  onClose,
  onSaved
}: {
  group: SyncGroupWithItems | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(group);
  const [name, setName] = useState(group?.name ?? "");
  const [mode, setMode] = useState<SyncMode>(group?.mode ?? "mirror");
  const [syncStock, setSyncStock] = useState(group?.syncStock ?? true);
  const [syncPrice, setSyncPrice] = useState(group?.syncPrice ?? false);
  const [active, setActive] = useState(group?.active ?? true);
  const [items, setItems] = useState<DraftItem[]>(() => (group ? group.items.map(fromExisting) : []));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // When mode changes during creation, drop items whose roles don't apply.
    setItems((prev) => prev.filter((i) => roleApplies(i.role, mode)));
  }, [mode]);

  function roleApplies(role: ItemRole, m: SyncMode): boolean {
    if (m === "mirror") return role === "source" || role === "target";
    if (m === "shared_pool") return role === "member";
    return role === "combo" || role === "component";
  }

  function addSelection(selected: VariantOption[], role: ItemRole) {
    setItems((prev) => {
      const map = new Map(prev.map((it) => [it.shopifyVariantId + "|" + it.role, it]));
      for (const opt of selected) {
        const key = opt.shopifyVariantId + "|" + role;
        if (!map.has(key)) map.set(key, fromVariantOption(opt, role));
      }
      return Array.from(map.values());
    });
  }

  function patchItem(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError("Group name is required");
      return;
    }
    if (items.length === 0) {
      setError("Add at least one variant to the group");
      return;
    }
    if (mode === "mirror") {
      const sources = items.filter((it) => it.role === "source");
      if (sources.length !== 1) {
        setError("Mirror mode requires exactly one source");
        return;
      }
      if (!items.some((it) => it.role === "target")) {
        setError("Mirror mode requires at least one target");
        return;
      }
    }
    if (mode === "shared_pool" && items.length < 2) {
      setError("Shared pool needs at least 2 members");
      return;
    }
    if (mode === "bundle") {
      if (!items.some((it) => it.role === "combo")) {
        setError("Bundle needs at least one combo variant");
        return;
      }
      if (!items.some((it) => it.role === "component")) {
        setError("Bundle needs at least one component variant");
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        mode,
        syncStock,
        syncPrice,
        active,
        items: items.map((it) => ({
          shopifyVariantId: it.shopifyVariantId,
          inventoryItemId: it.inventoryItemId,
          role: it.role,
          quantityRequired: it.quantityRequired,
          stockBuffer: it.stockBuffer,
          priceMultiplier: it.priceMultiplier,
          syncStock: it.syncStock,
          syncPrice: it.syncPrice
        }))
      };

      if (isEdit && group) {
        await fetch(`/api/inventory-sync/groups/${group.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: payload.name, syncStock, syncPrice, active })
        });
        // Replace items: delete then add. Simpler than diffing for now.
        for (const existing of group.items) {
          await fetch(`/api/inventory-sync/groups/${group.id}/items`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId: existing.id })
          });
        }
        for (const it of payload.items) {
          await fetch(`/api/inventory-sync/groups/${group.id}/items`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(it)
          });
        }
      } else {
        const res = await fetch("/api/inventory-sync/groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const body = await res.json();
        if (!body.ok) {
          setError(body.error ?? "Failed to create group");
          setSubmitting(false);
          return;
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  const excludeIds = items.map((it) => it.shopifyVariantId);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-3xl rounded-2xl bg-white shadow-panel">
        <div className="flex items-center justify-between border-b border-line/60 px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
              {isEdit ? "Edit group" : "Create group"}
            </p>
            <h2 className="text-lg font-semibold text-ink">{isEdit ? group?.name : "New linked-inventory group"}</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink">
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" className="h-5 w-5">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-ink">
              <span className="text-muted">Group name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Wholesale Mirror Group A"
                className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink"
              />
            </label>
            <div>
              <p className="text-xs font-semibold text-muted">Mode</p>
              <div className="mt-1 grid grid-cols-3 gap-1">
                {(["mirror", "shared_pool", "bundle"] as SyncMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={isEdit}
                    onClick={() => setMode(m)}
                    title={isEdit ? "Mode cannot be changed after creation" : undefined}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-xs font-semibold transition",
                      mode === m ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-canvas",
                      isEdit && "cursor-not-allowed opacity-60"
                    )}
                  >
                    {m === "mirror" ? "Mirror" : m === "shared_pool" ? "Shared Pool" : "Bundle"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 rounded-xl border border-line/60 bg-canvas/50 px-3 py-2 text-xs">
            <Toggle label="Sync stock" checked={syncStock} onChange={setSyncStock} />
            <Toggle label="Sync price" checked={syncPrice} onChange={setSyncPrice} />
            <Toggle label="Active" checked={active} onChange={setActive} />
          </div>

          {mode === "mirror" ? (
            <>
              <Section title="Source variant" description="One variant whose stock and price drive the targets.">
                <VariantPicker
                  value={items.find((it) => it.role === "source")?.shopifyVariantId ?? null}
                  multi={false}
                  excludeIds={excludeIds}
                  onChange={(selected) => {
                    setItems((prev) => {
                      const withoutSource = prev.filter((it) => it.role !== "source");
                      return selected[0] ? [fromVariantOption(selected[0], "source"), ...withoutSource] : withoutSource;
                    });
                  }}
                />
                <ItemRows items={items.filter((it) => it.role === "source")} setRole={null} patchItem={patchItem} removeItem={removeItem} indexed={items} mode={mode} />
              </Section>
              <Section title="Target variants" description="One or many variants that follow the source. Stock buffer subtracts from source stock; price multiplier scales source price.">
                <VariantPicker
                  value={items.filter((it) => it.role === "target").map((it) => it.shopifyVariantId)}
                  multi
                  excludeIds={excludeIds}
                  onChange={(selected) => addSelection(selected, "target")}
                />
                <ItemRows items={items.filter((it) => it.role === "target")} setRole={null} patchItem={patchItem} removeItem={removeItem} indexed={items} mode={mode} />
              </Section>
            </>
          ) : null}

          {mode === "shared_pool" ? (
            <Section title="Pool members" description="All these variants represent one physical stock pool.">
              <VariantPicker
                value={items.map((it) => it.shopifyVariantId)}
                multi
                excludeIds={excludeIds}
                onChange={(selected) => addSelection(selected, "member")}
              />
              <ItemRows items={items} setRole={null} patchItem={patchItem} removeItem={removeItem} indexed={items} mode={mode} />
            </Section>
          ) : null}

          {mode === "bundle" ? (
            <>
              <Section title="Combo variant(s)" description="The bundle variant whose stock is calculated from its components.">
                <VariantPicker
                  value={items.filter((it) => it.role === "combo").map((it) => it.shopifyVariantId)}
                  multi
                  excludeIds={excludeIds}
                  onChange={(selected) => addSelection(selected, "combo")}
                />
                <ItemRows items={items.filter((it) => it.role === "combo")} setRole={null} patchItem={patchItem} removeItem={removeItem} indexed={items} mode={mode} />
              </Section>
              <Section title="Component variants" description="Stock for the combo is min(floor(component_stock / quantity_required)).">
                <VariantPicker
                  value={items.filter((it) => it.role === "component").map((it) => it.shopifyVariantId)}
                  multi
                  excludeIds={excludeIds}
                  onChange={(selected) => addSelection(selected, "component")}
                />
                <ItemRows items={items.filter((it) => it.role === "component")} setRole={null} patchItem={patchItem} removeItem={removeItem} indexed={items} mode={mode} />
              </Section>
            </>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line/60 px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-xl border border-line bg-white px-4 py-2 text-xs font-semibold text-ink hover:bg-canvas"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={submitting}
            className="rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Create group"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line/60 bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">{title}</p>
      <p className="mt-0.5 text-[11px] leading-4 text-muted">{description}</p>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-7 appearance-none rounded-full bg-slate-200 transition checked:bg-emerald-500"
      />
      {label}
    </label>
  );
}

function ItemRows({
  items,
  patchItem,
  removeItem,
  indexed,
  mode
}: {
  items: DraftItem[];
  setRole: null;
  patchItem: (idx: number, patch: Partial<DraftItem>) => void;
  removeItem: (idx: number) => void;
  indexed: DraftItem[];
  mode: SyncMode;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="divide-y divide-line/40 rounded-lg border border-line/40 bg-canvas/40">
      {items.map((item) => {
        const idx = indexed.findIndex((i) => i === item);
        return (
          <li key={item.shopifyVariantId + item.role} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-ink">{item.productLabel}</p>
              <p className="truncate text-[10px] text-muted">
                {item.variantLabel} · <code className="font-mono">{item.shopifyVariantId.split("/").pop()}</code>
              </p>
            </div>
            {mode === "mirror" && item.role === "target" ? (
              <>
                <NumField label="buffer" value={item.stockBuffer} onChange={(v) => patchItem(idx, { stockBuffer: v })} />
                <NumField label="× price" value={item.priceMultiplier} step={0.01} onChange={(v) => patchItem(idx, { priceMultiplier: v })} />
              </>
            ) : null}
            {mode === "bundle" && item.role === "component" ? (
              <NumField label="qty/combo" value={item.quantityRequired} onChange={(v) => patchItem(idx, { quantityRequired: Math.max(1, Math.floor(v)) })} />
            ) : null}
            <button
              onClick={() => removeItem(idx)}
              className="rounded-md p-1 text-muted hover:bg-rose-50 hover:text-rose-700"
              title="Remove"
            >
              <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" className="h-4 w-4">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              </svg>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function NumField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (next: number) => void; step?: number }) {
  return (
    <label className="flex items-center gap-1 text-[10px] font-semibold text-muted">
      {label}
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-16 rounded border border-line bg-white px-1.5 py-1 text-xs text-ink"
      />
    </label>
  );
}
