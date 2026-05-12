// Shopify-standard CSV parser. Groups rows by Handle into product structures
// with variants, images, and metafields — the same shape our export emits.

export type ParsedMetafield = {
  namespace: string;
  key: string;
  type: string;
  value: string;
  ref?: string;
};

export type ParsedVariant = {
  rowNumber: number;
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
  variants: ParsedVariant[];
  images: ParsedImage[];
  metafields: ParsedMetafield[];
};

export type ParseResult = {
  products: ParsedProduct[];
  errors: Array<{ row: number; message: string }>;
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

function parseCsvRaw(text: string): { headers: string[]; rows: string[][] } {
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

function emptyProduct(handle: string): ParsedProduct {
  return {
    handle,
    rowNumbers: [],
    title: "",
    bodyHtml: "",
    vendor: "",
    productCategory: "",
    productType: "",
    tags: [],
    published: "",
    status: "active",
    seoTitle: "",
    seoDescription: "",
    giftCard: false,
    option1Name: "",
    option2Name: "",
    option3Name: "",
    variants: [],
    images: [],
    metafields: []
  };
}

function emptyVariant(rowNumber: number): ParsedVariant {
  return {
    rowNumber,
    sku: "",
    barcode: "",
    price: "",
    compareAtPrice: "",
    inventoryQuantity: "",
    inventoryPolicy: "deny",
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

export function parseShopifyCsv(text: string): ParseResult {
  const { headers, rows } = parseCsvRaw(text);
  const errors: ParseResult["errors"] = [];

  if (headers.length === 0) {
    return { products: [], errors: [{ row: 0, message: "Empty CSV" }] };
  }
  if (!headers.some((h) => h.toLowerCase() === "handle")) {
    return { products: [], errors: [{ row: 0, message: "Missing required Handle column" }] };
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
  // Discover Image 1..N columns up front (case-insensitive).
  const imageColIndexes: number[] = [];
  headers.forEach((h, i) => {
    const match = h.match(METAFIELD_HEADER);
    if (match) {
      const scope: "Product" | "Variant" = match[1].toLowerCase() === "product" ? "Product" : "Variant";
      const namespace = match[2].trim();
      const key = match[3].trim();
      const typeOrSuffix = match[4].trim();

      if (REF_SUFFIX.test(typeOrSuffix)) {
        if (typeOrSuffix.toLowerCase() === "ref") {
          refColByKey.set(`${scope}|${namespace}.${key}`, i);
        }
        // [display] columns are humans-only; ignore on import.
      } else {
        metafieldCols.push({ scope, namespace, key, type: typeOrSuffix, index: i });
      }
    }
    if (/^\s*image\s+\d+\s*$/i.test(h)) {
      imageColIndexes.push(i);
    }
  });

  const productsByHandle = new Map<string, ParsedProduct>();

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2; // 1-indexed + header
    const handle = val(row, "Handle").trim();
    if (!handle) {
      // Trailing blank line — ignore.
      if (row.every((cell) => cell.trim() === "")) return;
      errors.push({ row: rowNumber, message: "Missing Handle" });
      return;
    }

    let product = productsByHandle.get(handle);
    const isFirstRow = !product;
    if (!product) {
      product = emptyProduct(handle);
      productsByHandle.set(handle, product);
    }
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
      product.status = (val(row, "Status") || "active").toLowerCase();
      product.seoTitle = val(row, "SEO Title");
      product.seoDescription = val(row, "SEO Description");
      product.giftCard = parseBool(val(row, "Gift Card"));
      product.option1Name = val(row, "Option1 Name");
      product.option2Name = val(row, "Option2 Name");
      product.option3Name = val(row, "Option3 Name");

      for (const col of metafieldCols.filter((c) => c.scope === "Product")) {
        const value = row[col.index] ?? "";
        if (value.trim() !== "") {
          const refIdx = refColByKey.get(`Product|${col.namespace}.${col.key}`);
          const ref = refIdx !== undefined ? (row[refIdx] ?? "").trim() : "";
          product.metafields.push({
            namespace: col.namespace,
            key: col.key,
            type: col.type,
            value,
            ref: ref || undefined
          });
        }
      }
    } else {
      // Pick up overrides from subsequent rows in case Shopify exporter put values there.
      if (!product.title && val(row, "Title")) product.title = val(row, "Title");
    }

    // Variant row detection: has a SKU, options, or pricing/inventory data.
    const sku = val(row, "Variant SKU");
    const option1 = val(row, "Option1 Value");
    const option2 = val(row, "Option2 Value");
    const option3 = val(row, "Option3 Value");
    const price = val(row, "Variant Price");
    const inventory = val(row, "Variant Inventory Qty");
    const isVariantRow =
      sku !== "" || option1 !== "" || option2 !== "" || option3 !== "" || price !== "" || inventory !== "";

    if (isVariantRow) {
      // Dedupe by (option1, option2, option3): Shopify CSVs (and some of our
      // older exports) emit additional rows for extra images with option
      // values copied from the original variant row. Merge those into the
      // existing variant instead of creating a duplicate.
      const optionKey = `${option1}|${option2}|${option3}`;
      let variant = product.variants.find(
        (v) => `${v.option1Value}|${v.option2Value}|${v.option3Value}` === optionKey
      );
      const isNew = !variant;
      if (!variant) {
        variant = emptyVariant(rowNumber);
        variant.option1Value = option1;
        variant.option2Value = option2;
        variant.option3Value = option3;
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
            value,
            ref: ref || undefined
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
    if (!product.title && product.variants.length === 0) {
      errors.push({
        row: product.rowNumbers[0] ?? 0,
        message: `Product "${product.handle}" needs at least a Title or a variant row`
      });
    }
    if (product.variants.length === 0) {
      // No variant rows — Shopify still needs at least one variant. Create a default from the product fields.
      const fallback = emptyVariant(product.rowNumbers[0] ?? 0);
      product.variants.push(fallback);
    }
    // Sort images by position for stable order.
    product.images.sort((a, b) => a.position - b.position);
  }

  return { products: Array.from(productsByHandle.values()), errors };
}
