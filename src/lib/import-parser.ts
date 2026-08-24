// Shopify-standard CSV parser. Groups rows by Handle into product structures
// with variants, images, and metafields — the same shape our export emits.

export type ParsedMetafield = {
  namespace: string;
  key: string;
  type: string;
  value: string;
  ref?: string;
  // Set when the value came from a reference metafield's [display] column and
  // there was no value/[ref] column to resolve from (e.g. custom.color = "Rot").
  // The push step looks up the metafield's real type in the destination shop
  // and resolves each label to a metaobject GID by display name (creating the
  // metaobject if it doesn't exist). `type` is empty until then.
  byDisplayName?: boolean;
};

export type ParsedVariant = {
  rowNumber: number;
  variantId: string;
  sku: string;
  barcode: string;
  price: string;
  compareAtPrice: string;
  inventoryQuantity: string;
  inventoryPolicy: string;
  inventoryTracker: string;
  requiresShipping: string;
  taxable: string;
  taxCode: string;
  weightGrams: string;
  weightUnit: string;
  costPerItem: string;
  countryOfOrigin: string;
  harmonizedSystemCode: string;
  fulfillmentService: string;
  option1Value: string;
  option2Value: string;
  option3Value: string;
  variantImage: string;
  metafields: ParsedMetafield[];
};

export type ParsedImage = {
  src: string;
  position: number;
  altText: string;
};

export type ParsedProduct = {
  handle: string;
  productId: string;
  // True if any row in the CSV provided an ID for this product, even if
  // the value failed to parse (e.g. Excel scientific notation). Lets the
  // validation pass treat it as a partial-update intent so we don't pile
  // a misleading "needs Title or variant row" error on top of the real one.
  productIdProvided: boolean;
  rowNumbers: number[];
  title: string;
  bodyHtml: string;
  vendor: string;
  productCategory: string;
  productType: string;
  tags: string[];
  published: string;
  status: string;
  seoTitle: string;
  seoDescription: string;
  giftCard: boolean;
  option1Name: string;
  option2Name: string;
  option3Name: string;
  // Manual-collection handles this product should belong to (additive on import).
  collections: string[];
  variants: ParsedVariant[];
  images: ParsedImage[];
  metafields: ParsedMetafield[];
};

export type ParseResult = {
  products: ParsedProduct[];
  errors: Array<{ row: number; message: string }>;
  // Non-fatal advisories — the import still runs, but some data was reshaped
  // (bare list values wrapped as JSON) or can't be imported (reference
  // metafields that only carry a [display] column). Row 0 = whole-file scope.
  warnings: Array<{ row: number; message: string }>;
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseCsvRaw(text: string): { headers: string[]; rows: string[][] } {
  const cleaned = text.replace(/\r\n?/g, "\n").trim();
  if (!cleaned) return { headers: [], rows: [] };
  const lines = cleaned.split("\n");

  // Multi-line CSV: a row continues until quotes balance.
  const rawRows: string[] = [];
  let buffer = "";
  let openQuotes = false;
  for (const line of lines) {
    const quoteCount = (line.match(/"/g) ?? []).length;
    if (!buffer) {
      buffer = line;
    } else {
      buffer += "\n" + line;
    }
    openQuotes = openQuotes !== (quoteCount % 2 === 1);
    if (!openQuotes) {
      rawRows.push(buffer);
      buffer = "";
    }
  }
  if (buffer) rawRows.push(buffer);

  const headers = splitCsvLine(rawRows[0] ?? "").map((h) => h.trim());
  const rows = rawRows.slice(1).map((line) => splitCsvLine(line).map((v) => v.trim()));
  return { headers, rows };
}

const METAFIELD_HEADER = /^\s*(Product|Variant)\s+Metafield:\s*(.+?)\.(.+?)\s*\[(.+?)\]\s*$/i;
const REF_SUFFIX = /^(display|ref)$/i;

// Reference-backed metafield types resolve their value from the companion
// [ref] column (portable keys), so their raw cell text is never sent to
// Shopify as-is — list normalization must leave them untouched.
const REFERENCE_TYPE_RE = /^(list\.)?(metaobject|product|variant|collection|file|page)_reference$/i;

// Shopify's `list.*` metafields expect the value to be a JSON-encoded array
// string (e.g. `["Stoff"]`), but native Shopify/Matrixify exports often write
// the bare scalar or a comma-separated list ("Stoff" / "Blau, Gelb"). Wrap
// those into the JSON array Shopify requires. Already-JSON arrays and
// reference-backed lists (resolved via [ref]) pass through unchanged.
function normalizeListValue(type: string, value: string): string {
  if (!/^list\./i.test(type) || REFERENCE_TYPE_RE.test(type)) return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (trimmed.startsWith("[")) {
    try {
      if (Array.isArray(JSON.parse(trimmed))) return trimmed;
    } catch {
      // Not valid JSON despite the leading "[" — fall through and treat as scalar.
    }
  }
  // A single cell can hold several list items either comma-separated
  // ("Blau, Gelb") or, when authored in Excel/Sheets, one per line. When the
  // cell spans multiple lines, newlines are the delimiter — splitting on commas
  // instead would leave the embedded line breaks inside each item, which
  // Shopify rejects for text lists ("Value must be a single line text string").
  // Comma-splitting stays the default so values that legitimately contain a
  // comma survive when the author used one value per line.
  const hasNewline = /[\r\n]/.test(trimmed);
  const items = trimmed
    .split(hasNewline ? /[\r\n]+/ : ",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) return value;
  if (/^list\.(number_integer|number_decimal)$/i.test(type) && items.every((i) => /^-?\d+(\.\d+)?$/.test(i))) {
    return JSON.stringify(items.map(Number));
  }
  if (/^list\.boolean$/i.test(type)) {
    return JSON.stringify(items.map((i) => /^(true|yes|1)$/i.test(i)));
  }
  return JSON.stringify(items);
}

function emptyProduct(handle: string): ParsedProduct {
  return {
    handle,
    productId: "",
    productIdProvided: false,
    rowNumbers: [],
    title: "",
    bodyHtml: "",
    vendor: "",
    productCategory: "",
    productType: "",
    tags: [],
    published: "",
    status: "",
    seoTitle: "",
    seoDescription: "",
    giftCard: false,
    option1Name: "",
    option2Name: "",
    option3Name: "",
    collections: [],
    variants: [],
    images: [],
    metafields: []
  };
}

function emptyVariant(rowNumber: number): ParsedVariant {
  return {
    rowNumber,
    variantId: "",
    sku: "",
    barcode: "",
    price: "",
    compareAtPrice: "",
    inventoryQuantity: "",
    inventoryPolicy: "",
    inventoryTracker: "",
    requiresShipping: "",
    taxable: "",
    taxCode: "",
    weightGrams: "",
    weightUnit: "",
    costPerItem: "",
    countryOfOrigin: "",
    harmonizedSystemCode: "",
    fulfillmentService: "manual",
    option1Value: "",
    option2Value: "",
    option3Value: "",
    variantImage: "",
    metafields: []
  };
}

function parseBool(value: string): boolean {
  return /^(true|yes|1)$/i.test(value.trim());
}

// Excel mangles long numeric Shopify IDs into scientific notation
// (1234567890123 → "1.23E+12"). Detect that case and return a sentinel
// so the parser can emit a clear row-level error — silently rounding
// would risk pointing at the wrong product entirely.
const SCIENTIFIC_ID = "__SCIENTIFIC_NOTATION__";
function normalizeShopifyId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("gid://")) return trimmed;
  if (/^\d+$/.test(trimmed)) return trimmed;
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(trimmed)) return SCIENTIFIC_ID;
  return trimmed;
}

export function parseShopifyCsv(text: string): ParseResult {
  const { headers, rows } = parseCsvRaw(text);
  const errors: ParseResult["errors"] = [];
  const warnings: ParseResult["warnings"] = [];

  if (headers.length === 0) {
    return { products: [], errors: [{ row: 0, message: "Empty CSV" }], warnings };
  }
  const hasHandle = headers.some((h) => h.toLowerCase() === "handle");
  const hasId = headers.some((h) => h.toLowerCase() === "id");
  if (!hasHandle && !hasId) {
    return { products: [], errors: [{ row: 0, message: "Missing required Handle or ID column" }], warnings };
  }

  const headerIndex = new Map<string, number>();
  headers.forEach((h, i) => headerIndex.set(h.toLowerCase(), i));

  function val(row: string[], name: string): string {
    const i = headerIndex.get(name.toLowerCase());
    return i !== undefined ? row[i] ?? "" : "";
  }

  // Discover metafield columns up front.
  const metafieldCols: Array<{ scope: "Product" | "Variant"; namespace: string; key: string; type: string; index: number }> = [];
  // Map of "<scope>|<ns>.<key>" -> column index for the [ref] companion column.
  const refColByKey = new Map<string, number>();
  // Map of "<scope>|<ns>.<key>" -> [display] column index. Used to detect
  // reference metafields that arrive display-only (no value column).
  const displayColByKey = new Map<string, number>();
  // Metafield keys ("<scope>|<ns>.<key>") that have an importable value column.
  const valueColKeys = new Set<string>();
  // Discover Image 1..N columns up front (case-insensitive).
  const imageColIndexes: number[] = [];
  headers.forEach((h, i) => {
    const match = h.match(METAFIELD_HEADER);
    if (match) {
      const scope: "Product" | "Variant" = match[1].toLowerCase() === "product" ? "Product" : "Variant";
      const namespace = match[2].trim();
      const key = match[3].trim();
      const typeOrSuffix = match[4].trim();
      const mfKey = `${scope}|${namespace}.${key}`;

      if (REF_SUFFIX.test(typeOrSuffix)) {
        if (typeOrSuffix.toLowerCase() === "ref") {
          refColByKey.set(mfKey, i);
        } else {
          // [display] columns are humans-only; ignore as a value source, but
          // remember them in case they're the ONLY column present (resolve by name).
          displayColByKey.set(mfKey, i);
        }
      } else {
        metafieldCols.push({ scope, namespace, key, type: typeOrSuffix, index: i });
        valueColKeys.add(mfKey);
      }
    }
    if (/^\s*image\s+\d+\s*$/i.test(h)) {
      imageColIndexes.push(i);
    }
  });

  // Reference metafields that arrived display-only (a [display] column with no
  // matching value column, e.g. custom.color). These can't be resolved from
  // portable keys, so we carry the display label and resolve it by name at
  // push time (match an existing metaobject, or create one).
  const displayOnlyCols: Array<{ scope: "Product" | "Variant"; namespace: string; key: string; index: number }> = [];
  for (const [mfKey, index] of displayColByKey) {
    if (valueColKeys.has(mfKey)) continue; // a real value column exists — normal path handles it
    const sep = mfKey.indexOf("|");
    const scope = mfKey.slice(0, sep) as "Product" | "Variant";
    const nsKey = mfKey.slice(sep + 1);
    const dot = nsKey.indexOf(".");
    displayOnlyCols.push({
      scope,
      namespace: nsKey.slice(0, dot),
      key: nsKey.slice(dot + 1),
      index
    });
  }

  const productsByHandle = new Map<string, ParsedProduct>();

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2; // 1-indexed + header
    const handle = val(row, "Handle").trim();
    const rawIdCell = val(row, "ID").trim();
    let productIdRaw = normalizeShopifyId(rawIdCell);
    if (productIdRaw === SCIENTIFIC_ID) {
      errors.push({
        row: rowNumber,
        message:
          `ID column has scientific notation (e.g. "1.58E+13") — Excel rounded the value. ` +
          `Re-open the CSV in Google Sheets, or in Excel format the ID column as Text before saving.`
      });
      productIdRaw = "";
    }
    const idIntent = rawIdCell !== "";
    // Group by handle when present; otherwise use the product ID. This lets
    // a CSV update existing products by ID without a handle column, and also
    // makes handle renames safe (every row of the same product still groups
    // together because they share the same Handle value in the file).
    const groupKey = handle || (productIdRaw ? `id:${productIdRaw}` : "");
    if (!groupKey) {
      // Trailing blank line — ignore.
      if (row.every((cell) => cell.trim() === "")) return;
      errors.push({ row: rowNumber, message: "Missing Handle or ID" });
      return;
    }

    let product = productsByHandle.get(groupKey);
    const isFirstRow = !product;
    if (!product) {
      product = emptyProduct(handle);
      productsByHandle.set(groupKey, product);
    }
    if (productIdRaw && !product.productId) product.productId = productIdRaw;
    if (idIntent) product.productIdProvided = true;
    product.rowNumbers.push(rowNumber);

    if (isFirstRow) {
      product.title = val(row, "Title");
      product.bodyHtml = val(row, "Body (HTML)") || val(row, "Body HTML");
      product.vendor = val(row, "Vendor");
      product.productCategory = val(row, "Product Category");
      product.productType = val(row, "Type");
      product.tags = val(row, "Tags")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      product.published = val(row, "Published");
      product.status = val(row, "Status").toLowerCase();
      product.seoTitle = val(row, "SEO Title");
      product.seoDescription = val(row, "SEO Description");
      product.giftCard = parseBool(val(row, "Gift Card"));
      product.option1Name = val(row, "Option1 Name");
      product.option2Name = val(row, "Option2 Name");
      product.option3Name = val(row, "Option3 Name");
      product.collections = val(row, "Collections")
        .split(",")
        .map((handle) => handle.trim())
        .filter(Boolean);

      for (const col of metafieldCols.filter((c) => c.scope === "Product")) {
        const value = row[col.index] ?? "";
        if (value.trim() !== "") {
          const refIdx = refColByKey.get(`Product|${col.namespace}.${col.key}`);
          const ref = refIdx !== undefined ? (row[refIdx] ?? "").trim() : "";
          product.metafields.push({
            namespace: col.namespace,
            key: col.key,
            type: col.type,
            value: normalizeListValue(col.type, value),
            ref: ref || undefined
          });
        }
      }

      for (const col of displayOnlyCols.filter((c) => c.scope === "Product")) {
        const value = (row[col.index] ?? "").trim();
        if (value !== "") {
          product.metafields.push({
            namespace: col.namespace,
            key: col.key,
            type: "",
            value,
            byDisplayName: true
          });
        }
      }
    } else {
      // Pick up overrides from subsequent rows in case Shopify exporter put values there.
      if (!product.title && val(row, "Title")) product.title = val(row, "Title");
    }

    // Variant row detection: has a SKU, options, pricing/inventory data, or
    // an explicit Variant ID (partial-update rows that touch only one field).
    const sku = val(row, "Variant SKU");
    let variantIdRaw = normalizeShopifyId(val(row, "Variant ID"));
    if (variantIdRaw === SCIENTIFIC_ID) {
      errors.push({
        row: rowNumber,
        message:
          `Variant ID column has scientific notation — Excel rounded the value. ` +
          `Re-open the CSV in Google Sheets, or in Excel format the Variant ID column as Text before saving.`
      });
      variantIdRaw = "";
    }
    const option1 = val(row, "Option1 Value");
    const option2 = val(row, "Option2 Value");
    const option3 = val(row, "Option3 Value");
    const price = val(row, "Variant Price");
    const inventory = val(row, "Variant Inventory Qty");
    const isVariantRow =
      sku !== "" || variantIdRaw !== "" || option1 !== "" || option2 !== "" || option3 !== "" || price !== "" || inventory !== "";

    if (isVariantRow) {
      // Prefer Variant ID for dedupe when present (lets partial-update CSVs
      // with empty option columns still identify each variant). Otherwise
      // fall back to the (option1, option2, option3) key — Shopify-style
      // CSVs sometimes emit extra image rows that share option values.
      let variant = variantIdRaw
        ? product.variants.find((v) => v.variantId === variantIdRaw)
        : product.variants.find(
            (v) => `${v.option1Value}|${v.option2Value}|${v.option3Value}` === `${option1}|${option2}|${option3}`
          );
      const isNew = !variant;
      if (!variant) {
        variant = emptyVariant(rowNumber);
        variant.variantId = variantIdRaw;
        variant.option1Value = option1;
        variant.option2Value = option2;
        variant.option3Value = option3;
      } else if (variantIdRaw && !variant.variantId) {
        variant.variantId = variantIdRaw;
      }

      function setIfPresent(field: keyof ParsedVariant, value: string) {
        if (!variant) return;
        if (value && value.trim() !== "") {
          (variant as Record<string, unknown>)[field as string] = value;
        }
      }

      setIfPresent("sku", sku);
      setIfPresent("barcode", val(row, "Variant Barcode"));
      setIfPresent("price", price);
      setIfPresent("compareAtPrice", val(row, "Variant Compare At Price"));
      setIfPresent("inventoryQuantity", inventory);
      setIfPresent("inventoryPolicy", (val(row, "Variant Inventory Policy") || "").toLowerCase());
      setIfPresent("inventoryTracker", val(row, "Variant Inventory Tracker"));
      setIfPresent("requiresShipping", val(row, "Variant Requires Shipping"));
      setIfPresent("taxable", val(row, "Variant Taxable"));
      setIfPresent("taxCode", val(row, "Variant Tax Code"));
      setIfPresent("weightGrams", val(row, "Variant Grams"));
      setIfPresent("weightUnit", val(row, "Variant Weight Unit"));
      setIfPresent("costPerItem", val(row, "Cost per item"));
      setIfPresent("countryOfOrigin", val(row, "Country of Origin"));
      setIfPresent("harmonizedSystemCode", val(row, "Harmonized System Code"));
      setIfPresent("fulfillmentService", val(row, "Variant Fulfillment Service"));
      setIfPresent("variantImage", val(row, "Variant Image"));

      for (const col of metafieldCols.filter((c) => c.scope === "Variant")) {
        const value = row[col.index] ?? "";
        if (value.trim() !== "") {
          const refIdx = refColByKey.get(`Variant|${col.namespace}.${col.key}`);
          const ref = refIdx !== undefined ? (row[refIdx] ?? "").trim() : "";
          // Avoid pushing duplicates for the same (namespace, key).
          const existingIdx = variant.metafields.findIndex(
            (m) => m.namespace === col.namespace && m.key === col.key
          );
          const next = {
            namespace: col.namespace,
            key: col.key,
            type: col.type,
            value: normalizeListValue(col.type, value),
            ref: ref || undefined
          };
          if (existingIdx >= 0) variant.metafields[existingIdx] = next;
          else variant.metafields.push(next);
        }
      }

      for (const col of displayOnlyCols.filter((c) => c.scope === "Variant")) {
        const value = (row[col.index] ?? "").trim();
        if (value !== "") {
          const existingIdx = variant.metafields.findIndex(
            (m) => m.namespace === col.namespace && m.key === col.key
          );
          const next: ParsedMetafield = {
            namespace: col.namespace,
            key: col.key,
            type: "",
            value,
            byDisplayName: true
          };
          if (existingIdx >= 0) variant.metafields[existingIdx] = next;
          else variant.metafields.push(next);
        }
      }

      if (isNew) product.variants.push(variant);
    }

    // Images from Image 1..N columns — only read on the first row per product
    // (subsequent variant rows duplicate them, so reading once avoids duplicates).
    if (isFirstRow && imageColIndexes.length > 0) {
      imageColIndexes.forEach((colIdx, idx) => {
        const url = (row[colIdx] ?? "").trim();
        if (url) {
          product!.images.push({ src: url, position: idx + 1, altText: "" });
        }
      });
    }

    // Legacy fallback: standard Shopify Image Src + Position + Alt Text columns.
    const imageSrc = val(row, "Image Src");
    if (imageSrc) {
      const pos = Number(val(row, "Image Position")) || product.images.length + 1;
      // Avoid double-adding if Image 1..N already captured it.
      if (!product.images.some((img) => img.src === imageSrc)) {
        product.images.push({
          src: imageSrc,
          position: pos,
          altText: val(row, "Image Alt Text")
        });
      }
    }
  });

  // Validate each product minimally.
  for (const product of productsByHandle.values()) {
    // Partial-update rows (ID present) need neither a title nor a variant
    // row — they're updating an existing product. The Title/variant
    // requirement only applies to brand-new product creates. We use the
    // "provided" flag (not the parsed productId) so a row whose ID failed
    // to parse — e.g. Excel-mangled scientific notation — doesn't get a
    // misleading second error stacked on top of the ID error.
    const isPartialUpdate = product.productIdProvided;
    if (!isPartialUpdate && !product.title && product.variants.length === 0) {
      errors.push({
        row: product.rowNumbers[0] ?? 0,
        message: `Product "${product.handle}" needs at least a Title or a variant row`
      });
    }
    if (!isPartialUpdate && product.variants.length === 0) {
      // No variant rows — Shopify still needs at least one variant. Create a default from the product fields.
      const fallback = emptyVariant(product.rowNumbers[0] ?? 0);
      product.variants.push(fallback);
    }
    // Sort images by position for stable order.
    product.images.sort((a, b) => a.position - b.position);
  }

  // Note (whole-file scope) any reference metafields that arrived display-only
  // so the user knows these resolve by display name at push time (matched to an
  // existing metaobject, or created) rather than from portable [ref] keys.
  const displayOnlyWithData = displayOnlyCols.filter((col) =>
    rows.some((row) => (row[col.index] ?? "").trim() !== "")
  );
  for (const col of displayOnlyWithData) {
    warnings.push({
      row: 0,
      message: `Metafield ${col.namespace}.${col.key} arrived as display text only (no [ref] keys) — it will be matched to metaobjects by display name on push, creating any that don't exist.`
    });
  }

  return { products: Array.from(productsByHandle.values()), errors, warnings };
}
