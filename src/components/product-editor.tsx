"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/badge";
import type { Product, ProductStatus, Variant } from "@/lib/types";
import { cn, currency, slugify } from "@/lib/utils";

type Mode = "create" | "edit";

type Props = {
  open: boolean;
  mode: Mode;
  product?: Product | null;
  vendors: string[];
  productTypes: string[];
  onClose: () => void;
  onSaved: () => void;
  currencyCode?: string | null;
};

type VariantDraft = {
  id: number;
  sku: string;
  option1Value: string;
  option2Value: string;
  option3Value: string;
  price: string;
  compareAtPrice: string;
  inventoryQuantity: string;
  barcode: string;
  image: string;
};

type Draft = {
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  status: ProductStatus;
  tagsText: string;
  bodyHtml: string;
  seoTitle: string;
  seoDescription: string;
  images: string[];
  variants: VariantDraft[];
};

const STATUSES: ProductStatus[] = ["active", "draft", "archived"];

function variantToDraft(variant: Variant): VariantDraft {
  return {
    id: variant.id,
    sku: variant.sku,
    option1Value: variant.option1Value,
    option2Value: variant.option2Value ?? "",
    option3Value: variant.option3Value ?? "",
    price: String(variant.price ?? ""),
    compareAtPrice: variant.compareAtPrice ? String(variant.compareAtPrice) : "",
    inventoryQuantity: String(variant.inventoryQuantity ?? 0),
    barcode: variant.barcode ?? "",
    image: variant.image ?? variant.variantImages[0]?.src ?? ""
  };
}

function emptyVariant(): VariantDraft {
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    sku: "",
    option1Value: "",
    option2Value: "",
    option3Value: "",
    price: "0",
    compareAtPrice: "",
    inventoryQuantity: "0",
    barcode: "",
    image: ""
  };
}

function productToDraft(product: Product | null | undefined): Draft {
  if (!product) {
    return {
      title: "",
      handle: "",
      vendor: "",
      productType: "",
      status: "draft",
      tagsText: "",
      bodyHtml: "",
      seoTitle: "",
      seoDescription: "",
      images: [],
      variants: [emptyVariant()]
    };
  }
  return {
    title: product.title,
    handle: product.handle,
    vendor: product.vendor,
    productType: product.productType,
    status: product.status,
    tagsText: product.tags.join(", "),
    bodyHtml: product.bodyHtml,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    images: product.images.map((image) => image.src),
    variants: product.variants.length > 0 ? product.variants.map(variantToDraft) : [emptyVariant()]
  };
}

export function ProductEditor({
  open,
  mode,
  product,
  vendors,
  productTypes,
  onClose,
  onSaved,
  currencyCode
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => productToDraft(product));
  const [isSaving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [imageInput, setImageInput] = useState("");
  const [autoHandle, setAutoHandle] = useState(mode === "create");

  useEffect(() => {
    setDraft(productToDraft(product));
    setSavedMessage("");
    setErrorMessage("");
    setAutoHandle(mode === "create");
  }, [product, mode, open]);

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function handleTitleChange(value: string) {
    setDraft((prev) => ({
      ...prev,
      title: value,
      handle: autoHandle ? slugify(value) : prev.handle
    }));
  }

  function updateVariant(index: number, patch: Partial<VariantDraft>) {
    setDraft((prev) => ({
      ...prev,
      variants: prev.variants.map((variant, i) => (i === index ? { ...variant, ...patch } : variant))
    }));
  }

  function addVariant() {
    setDraft((prev) => ({ ...prev, variants: [...prev.variants, emptyVariant()] }));
  }

  function removeVariant(index: number) {
    setDraft((prev) => ({
      ...prev,
      variants: prev.variants.length === 1 ? prev.variants : prev.variants.filter((_, i) => i !== index)
    }));
  }

  function addImage() {
    const trimmed = imageInput.trim();
    if (!trimmed) return;
    setDraft((prev) => ({ ...prev, images: [...prev.images, trimmed] }));
    setImageInput("");
  }

  function removeImage(index: number) {
    setDraft((prev) => ({ ...prev, images: prev.images.filter((_, i) => i !== index) }));
  }

  const totalInventory = useMemo(
    () => draft.variants.reduce((sum, v) => sum + (Number(v.inventoryQuantity) || 0), 0),
    [draft.variants]
  );

  async function handleSave() {
    setSaving(true);
    setSavedMessage("");
    setErrorMessage("");

    const tagsArray = draft.tagsText
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    const payload = {
      title: draft.title.trim(),
      vendor: draft.vendor.trim(),
      productType: draft.productType.trim(),
      status: draft.status,
      tags: tagsArray,
      seoTitle: draft.seoTitle.trim(),
      seoDescription: draft.seoDescription.trim(),
      variants: draft.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku.trim(),
        option1Value: variant.option1Value.trim(),
        option2Value: variant.option2Value.trim(),
        option3Value: variant.option3Value.trim(),
        price: variant.price === "" ? null : Number(variant.price),
        compareAtPrice: variant.compareAtPrice === "" ? null : Number(variant.compareAtPrice),
        inventoryQuantity:
          variant.inventoryQuantity === "" ? null : Number(variant.inventoryQuantity),
        barcode: variant.barcode.trim(),
        image: variant.image.trim()
      }))
    };

    try {
      const url =
        mode === "edit" && product
          ? `/api/products/${product.id}`
          : "/api/products";
      const method = mode === "edit" && product ? "PATCH" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setErrorMessage(
          typeof body?.error === "string" ? body.error : "Failed to save. Check fields and try again."
        );
        return;
      }

      if (body?.noChange) {
        setSavedMessage(
          body?.message ??
            "No changes detected. The values you typed already match the current product, so nothing was staged."
        );
        return;
      }

      const changed: string[] | undefined = Array.isArray(body?.changedFields) ? body.changedFields : undefined;
      setSavedMessage(
        mode === "edit"
          ? body?.draftCreated
            ? changed && changed.length > 0
              ? `Staged draft · changed: ${changed.join(", ")}`
              : "Draft change staged. Approve from Drafts to push to Shopify."
            : "Saved."
          : "Product staged. Approve from Drafts to push to Shopify."
      );
      onSaved();
    } catch {
      setErrorMessage("Network error while saving.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-3xl flex-col bg-white shadow-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted">
              {mode === "create" ? "New product" : `Editing ${product?.handle ?? ""}`}
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">
              {draft.title || (mode === "create" ? "Untitled product" : product?.title)}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <Badge tone={draft.status === "active" ? "valid" : draft.status === "draft" ? "warning" : "neutral"}>
                {draft.status}
              </Badge>
              <span className="text-muted">·</span>
              <span className="text-muted">{draft.variants.length} variants</span>
              <span className="text-muted">·</span>
              <span className="text-muted">{totalInventory} on hand</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Details</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Title" required>
                <input
                  value={draft.title}
                  onChange={(event) => handleTitleChange(event.target.value)}
                  className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
                  placeholder="Product title"
                />
              </Field>
              <Field
                label="Handle"
                hint={autoHandle ? "Auto-generated from title" : "Edited manually"}
              >
                <div className="flex items-center gap-2">
                  <input
                    value={draft.handle}
                    onChange={(event) => {
                      setField("handle", slugify(event.target.value));
                      setAutoHandle(false);
                    }}
                    className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
                    placeholder="product-handle"
                  />
                  <button
                    onClick={() => {
                      setField("handle", slugify(draft.title));
                      setAutoHandle(true);
                    }}
                    className="rounded-xl border border-line px-3 py-2 text-xs font-medium text-muted hover:bg-canvas"
                    type="button"
                  >
                    Reset
                  </button>
                </div>
              </Field>
              <Field label="Vendor">
                <input
                  list="vendor-options"
                  value={draft.vendor}
                  onChange={(event) => setField("vendor", event.target.value)}
                  className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
                  placeholder="Brand or supplier"
                />
                <datalist id="vendor-options">
                  {vendors.map((vendor) => (
                    <option key={vendor} value={vendor} />
                  ))}
                </datalist>
              </Field>
              <Field label="Product Type / Custom Type">
                <input
                  list="type-options"
                  value={draft.productType}
                  onChange={(event) => setField("productType", event.target.value)}
                  className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
                  placeholder="e.g. T-Shirt"
                />
                <datalist id="type-options">
                  {productTypes.map((type) => (
                    <option key={type} value={type} />
                  ))}
                </datalist>
              </Field>
              <Field label="Status">
                <select
                  value={draft.status}
                  onChange={(event) => setField("status", event.target.value as ProductStatus)}
                  className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tags" hint="Comma-separated">
                <input
                  value={draft.tagsText}
                  onChange={(event) => setField("tagsText", event.target.value)}
                  className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
                  placeholder="cotton, summer, sale"
                />
              </Field>
            </div>

            <Field label="Description (HTML allowed)">
              <textarea
                value={draft.bodyHtml}
                onChange={(event) => setField("bodyHtml", event.target.value)}
                rows={4}
                className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
                placeholder="<p>Premium product description...</p>"
              />
            </Field>
          </section>

          <section className="mt-8 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Media</h3>
            <div className="flex flex-wrap gap-3">
              {draft.images.length === 0 ? (
                <p className="text-sm text-muted">No product images yet.</p>
              ) : (
                draft.images.map((src, index) => (
                  <div key={`${src}-${index}`} className="relative">
                    <div
                      className="h-24 w-24 rounded-2xl bg-cover bg-center bg-slate-100 ring-1 ring-line"
                      style={{ backgroundImage: `url(${src})` }}
                    />
                    <button
                      onClick={() => removeImage(index)}
                      type="button"
                      className="absolute -right-2 -top-2 h-6 w-6 rounded-full border border-line bg-white text-xs font-bold text-ink shadow"
                      aria-label="Remove image"
                    >
                      ×
                    </button>
                    <p className="mt-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted">
                      {index + 1}
                    </p>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={imageInput}
                onChange={(event) => setImageInput(event.target.value)}
                className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
                placeholder="Paste image URL (https://...)"
              />
              <button
                onClick={addImage}
                type="button"
                className="rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
              >
                Add
              </button>
            </div>
          </section>

          <section className="mt-8 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                Variants ({draft.variants.length})
              </h3>
              <button
                onClick={addVariant}
                type="button"
                className="rounded-xl border border-line bg-canvas px-3 py-2 text-xs font-semibold text-ink hover:bg-white"
              >
                + Add variant
              </button>
            </div>
            <div className="space-y-3">
              {draft.variants.map((variant, index) => (
                <div
                  key={variant.id}
                  className="rounded-2xl border border-line bg-canvas p-4 transition hover:border-brand/40"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-ink">
                      Variant {index + 1}
                      {variant.sku ? (
                        <span className="ml-2 font-mono text-xs font-normal text-muted">{variant.sku}</span>
                      ) : null}
                    </p>
                    <button
                      onClick={() => removeVariant(index)}
                      type="button"
                      className={cn(
                        "rounded-lg border border-line px-2 py-1 text-xs font-medium text-muted hover:text-rose-600",
                        draft.variants.length === 1 && "cursor-not-allowed opacity-40"
                      )}
                      disabled={draft.variants.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <SmallField label="Option 1">
                      <input
                        value={variant.option1Value}
                        onChange={(event) => updateVariant(index, { option1Value: event.target.value })}
                        className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                        placeholder="Color"
                      />
                    </SmallField>
                    <SmallField label="Option 2">
                      <input
                        value={variant.option2Value}
                        onChange={(event) => updateVariant(index, { option2Value: event.target.value })}
                        className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                        placeholder="Size"
                      />
                    </SmallField>
                    <SmallField label="Option 3">
                      <input
                        value={variant.option3Value}
                        onChange={(event) => updateVariant(index, { option3Value: event.target.value })}
                        className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                        placeholder="Material"
                      />
                    </SmallField>
                    <SmallField label="SKU">
                      <input
                        value={variant.sku}
                        onChange={(event) => updateVariant(index, { sku: event.target.value })}
                        className="w-full rounded-xl border border-line bg-white px-3 py-2 font-mono text-xs outline-none focus:border-brand"
                        placeholder="SKU-001"
                      />
                    </SmallField>
                    <SmallField label="Barcode">
                      <input
                        value={variant.barcode}
                        onChange={(event) => updateVariant(index, { barcode: event.target.value })}
                        className="w-full rounded-xl border border-line bg-white px-3 py-2 font-mono text-xs outline-none focus:border-brand"
                        placeholder="EAN / UPC"
                      />
                    </SmallField>
                    <SmallField label="Inventory">
                      <input
                        type="number"
                        value={variant.inventoryQuantity}
                        onChange={(event) =>
                          updateVariant(index, { inventoryQuantity: event.target.value })
                        }
                        className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                        placeholder="0"
                      />
                    </SmallField>
                    <SmallField label={`Price (${(currencyCode ?? "USD").toUpperCase()})`}>
                      <input
                        type="number"
                        step="0.01"
                        value={variant.price}
                        onChange={(event) => updateVariant(index, { price: event.target.value })}
                        className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                        placeholder="0.00"
                      />
                    </SmallField>
                    <SmallField label="Compare at">
                      <input
                        type="number"
                        step="0.01"
                        value={variant.compareAtPrice}
                        onChange={(event) =>
                          updateVariant(index, { compareAtPrice: event.target.value })
                        }
                        className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                        placeholder="0.00"
                      />
                    </SmallField>
                    <SmallField label="Image URL">
                      <input
                        value={variant.image}
                        onChange={(event) => updateVariant(index, { image: event.target.value })}
                        className="w-full rounded-xl border border-line bg-white px-3 py-2 text-xs outline-none focus:border-brand"
                        placeholder="https://..."
                      />
                    </SmallField>
                  </div>
                  {variant.price && variant.compareAtPrice ? (
                    <p className="mt-3 text-xs text-muted">
                      Effective discount{" "}
                      <span className="font-semibold text-emerald-700">
                        {(((Number(variant.compareAtPrice) - Number(variant.price)) /
                          Number(variant.compareAtPrice)) *
                          100 || 0
                        ).toFixed(0)}
                        %
                      </span>{" "}
                      from {currency(Number(variant.compareAtPrice) || 0, currencyCode)} →{" "}
                      {currency(Number(variant.price) || 0, currencyCode)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">SEO</h3>
            <Field label="SEO Title">
              <input
                value={draft.seoTitle}
                onChange={(event) => setField("seoTitle", event.target.value)}
                className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
              />
            </Field>
            <Field label="SEO Description">
              <textarea
                value={draft.seoDescription}
                onChange={(event) => setField("seoDescription", event.target.value)}
                rows={3}
                className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
              />
            </Field>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line bg-canvas px-6 py-4">
          <div className="text-xs text-muted">
            {savedMessage ? <span className="text-emerald-700">{savedMessage}</span> : null}
            {errorMessage ? <span className="text-rose-700">{errorMessage}</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              type="button"
              className="rounded-2xl border border-line bg-white px-5 py-3 text-sm font-semibold text-ink hover:bg-canvas"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              type="button"
              disabled={isSaving || !draft.title.trim()}
              className="rounded-2xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow-panel hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : mode === "edit" ? "Save as draft" : "Create product"}
            </button>
          </div>
        </footer>
      </aside>
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

function SmallField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
