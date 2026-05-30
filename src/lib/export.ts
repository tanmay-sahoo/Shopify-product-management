// Full Shopify-compatible CSV export.
//
// Reads from each product/variant `rawShopifyJson` (captured during sync) so
// every field the Admin API gave us is round-tripped: tax, inventory policy,
// weight, cost, gift card, category, alt text, etc. Falls back to mapped
// fields when raw payload is absent.

type RawWeight = { unit?: string | null; value?: number | string | null };
type RawMoney = { amount?: number | string | null; currencyCode?: string | null };

type RawInventoryItem = {
  id?: string | null;
  tracked?: boolean | null;
  requiresShipping?: boolean | null;
  measurement?: { weight?: RawWeight | null } | null;
  unitCost?: RawMoney | null;
  countryCodeOfOrigin?: string | null;
  harmonizedSystemCode?: string | null;
};

type RawSelectedOption = { name?: string | null; value?: string | null };

type RawVariant = {
  id?: string | null;
  title?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price?: string | number | null;
  compareAtPrice?: string | number | null;
  inventoryQuantity?: number | null;
  inventoryPolicy?: string | null;
  taxable?: boolean | null;
  taxCode?: string | null;
  position?: number | null;
  selectedOptions?: RawSelectedOption[] | null;
  image?: { url?: string | null; altText?: string | null } | null;
  inventoryItem?: RawInventoryItem | null;
};

type RawProductImage = {
  url?: string | null;
  altText?: string | null;
  position?: number | null;
};

type RawProduct = {
  id?: string | null;
  handle?: string | null;
  title?: string | null;
  descriptionHtml?: string | null;
  vendor?: string | null;
  productType?: string | null;
  tags?: string[] | string | null;
  status?: string | null;
  publishedAt?: string | null;
  templateSuffix?: string | null;
  isGiftCard?: boolean | null;
  category?: { fullName?: string | null; name?: string | null } | null;
  seo?: { title?: string | null; description?: string | null } | null;
  options?: Array<{ name?: string | null; values?: string[] | null; position?: number | null }> | null;
};

export type ExportMetafield = {
  namespace: string;
  key: string;
  type: string;
  value: string | null;
};

export type ExportProduct = {
  handle: string;
  title: string;
  bodyHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: string;
  seoTitle: string;
  seoDescription: string;
  images: Array<{ src: string; altText?: string | null; position?: number | null }>;
  metafields: ExportMetafield[];
  variants: Array<{
    sku: string;
    barcode: string;
    price: number | string | null;
    compareAtPrice: number | string | null;
    inventoryQuantity: number;
    option1Value: string;
    option2Value?: string | null;
    option3Value?: string | null;
    image?: string | null;
    rawJson?: RawVariant | null;
    metafields: ExportMetafield[];
  }>;
  rawJson?: RawProduct | null;
};

type ExportOptions = {
  shopDomain?: string;
  referenceLookup?: Map<string, string>;
  portableLookup?: Map<string, string>;
};

function escapeCsv(value: unknown) {
  const str = value === null || value === undefined ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function bool(v: boolean | null | undefined): string {
  return v ? "TRUE" : "FALSE";
}

function weightInGrams(weight: RawWeight | null | undefined): string {
  if (!weight || weight.value === null || weight.value === undefined) return "";
  const value = Number(weight.value);
  if (!Number.isFinite(value)) return "";
  const unit = (weight.unit ?? "GRAMS").toUpperCase();
  let grams: number;
  if (unit === "KILOGRAMS") grams = value * 1000;
  else if (unit === "POUNDS") grams = value * 453.59237;
  else if (unit === "OUNCES") grams = value * 28.349523125;
  else grams = value;
  return String(Math.round(grams));
}

function shopifyWeightUnit(unit: string | null | undefined): string {
  switch ((unit ?? "").toUpperCase()) {
    case "KILOGRAMS":
      return "kg";
    case "POUNDS":
      return "lb";
    case "OUNCES":
      return "oz";
    case "GRAMS":
      return "g";
    default:
      return "";
  }
}

function variantOptionValue(variant: ExportProduct["variants"][number], index: 1 | 2 | 3): string {
  const raw = variant.rawJson;
  if (raw?.selectedOptions && raw.selectedOptions[index - 1]) {
    return raw.selectedOptions[index - 1].value ?? "";
  }
  if (index === 1) return variant.option1Value ?? "";
  if (index === 2) return variant.option2Value ?? "";
  return variant.option3Value ?? "";
}

const STANDARD_COLUMNS = [
  "Handle",
  "ID",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Product Category",
  "Type",
  "Tags",
  "Published",
  "Option1 Name",
  "Option1 Value",
  "Option2 Name",
  "Option2 Value",
  "Option3 Name",
  "Option3 Value",
  "Variant SKU",
  "Variant ID",
  "Variant Grams",
  "Variant Inventory Tracker",
  "Variant Inventory Qty",
  "Variant Inventory Policy",
  "Variant Fulfillment Service",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Requires Shipping",
  "Variant Taxable",
  "Variant Barcode",
  "Gift Card",
  "SEO Title",
  "SEO Description",
  "Google Shopping / Google Product Category",
  "Google Shopping / Gender",
  "Google Shopping / Age Group",
  "Google Shopping / MPN",
  "Google Shopping / Condition",
  "Google Shopping / Custom Product",
  "Variant Image",
  "Variant Weight Unit",
  "Variant Tax Code",
  "Cost per item",
  "Country of Origin",
  "Harmonized System Code",
  "Status",
  "Product URL",
  "Admin URL"
] as const;

type CsvRow = Record<string, string>;

function emptyRow(columns: readonly string[]): CsvRow {
  return Object.fromEntries(columns.map((column) => [column, ""])) as CsvRow;
}

function optionName(rawProduct: RawProduct | null | undefined, index: number): string {
  return rawProduct?.options?.[index]?.name ?? "";
}

function metafieldColumnLabel(scope: "Product" | "Variant", mf: ExportMetafield): string {
  return `${scope} Metafield: ${mf.namespace}.${mf.key} [${mf.type}]`;
}

function metafieldDisplayColumnLabel(scope: "Product" | "Variant", mf: ExportMetafield): string {
  return `${scope} Metafield: ${mf.namespace}.${mf.key} [display]`;
}

function metafieldRefColumnLabel(scope: "Product" | "Variant", mf: ExportMetafield): string {
  return `${scope} Metafield: ${mf.namespace}.${mf.key} [ref]`;
}

const REF_TYPE = /^(list\.)?(metaobject|product|variant|collection|file|page)_reference$/;
function isReferenceMetafield(type: string): boolean {
  return REF_TYPE.test(type);
}

function resolvedDisplayValue(value: string | null, type: string, lookup: Map<string, string>): string {
  if (!value || !isReferenceMetafield(type)) return "";
  if (type.startsWith("list.")) {
    try {
      const arr = JSON.parse(value);
      if (Array.isArray(arr)) {
        return arr
          .map((gid: unknown) => (typeof gid === "string" ? (lookup.get(gid) ?? gid) : ""))
          .filter(Boolean)
          .join(", ");
      }
    } catch {
      // fall through
    }
    return value;
  }
  return lookup.get(value) ?? value;
}

function resolvedRefValue(value: string | null, type: string, lookup: Map<string, string>): string {
  if (!value || !isReferenceMetafield(type)) return "";
  if (type.startsWith("list.")) {
    try {
      const arr = JSON.parse(value);
      if (Array.isArray(arr)) {
        const keys = arr
          .map((gid: unknown) => (typeof gid === "string" ? lookup.get(gid) : null))
          .filter((k): k is string => Boolean(k));
        if (keys.length === 0) return "";
        return JSON.stringify(keys);
      }
    } catch {
      // fall through
    }
    return lookup.get(value) ?? "";
  }
  return lookup.get(value) ?? "";
}

function metafieldKeyOf(mf: ExportMetafield): string {
  return `${mf.namespace}.${mf.key}`;
}

function adminSlug(shopDomain?: string): string {
  if (!shopDomain) return "your-store";
  return shopDomain.replace(/\.myshopify\.com$/i, "");
}

export function toEnhancedCsv(products: ExportProduct[], options: ExportOptions = {}): string {
  const host = options.shopDomain ?? "your-store.myshopify.com";
  const slug = adminSlug(options.shopDomain);
  const referenceLookup = options.referenceLookup ?? new Map<string, string>();
  const portableLookup = options.portableLookup ?? new Map<string, string>();
  // Discover unique metafield definitions across the whole export so columns are stable.
  const productMetaMap = new Map<string, ExportMetafield>();
  const variantMetaMap = new Map<string, ExportMetafield>();
  for (const product of products) {
    for (const mf of product.metafields) productMetaMap.set(metafieldKeyOf(mf), mf);
    for (const variant of product.variants) {
      for (const mf of variant.metafields) variantMetaMap.set(metafieldKeyOf(mf), mf);
    }
  }
  const productMetafields = Array.from(productMetaMap.values()).sort((a, b) =>
    metafieldKeyOf(a).localeCompare(metafieldKeyOf(b))
  );
  const variantMetafields = Array.from(variantMetaMap.values()).sort((a, b) =>
    metafieldKeyOf(a).localeCompare(metafieldKeyOf(b))
  );
  function expandColumns(scope: "Product" | "Variant", mfs: ExportMetafield[]): string[] {
    const out: string[] = [];
    for (const mf of mfs) {
      out.push(metafieldColumnLabel(scope, mf));
      if (isReferenceMetafield(mf.type)) {
        out.push(metafieldDisplayColumnLabel(scope, mf));
        out.push(metafieldRefColumnLabel(scope, mf));
      }
    }
    return out;
  }
  const productMetaColumns = expandColumns("Product", productMetafields);
  const variantMetaColumns = expandColumns("Variant", variantMetafields);

  // Per-product flat image-URL grid — easy to skim, all URLs on one row.
  const maxImages = products.reduce((acc, product) => Math.max(acc, product.images.length), 0);
  const imageNumberedColumns = Array.from({ length: Math.max(maxImages, 1) }, (_, i) => `Image ${i + 1}`);

  const allColumns = [...STANDARD_COLUMNS, ...productMetaColumns, ...variantMetaColumns, ...imageNumberedColumns];

  const rows: CsvRow[] = [];

  for (const product of products) {
    const raw = product.rawJson ?? null;
    const images = product.images;
    const variants = product.variants;

    const baseHandle = product.handle;
    const optionNames = [optionName(raw, 0), optionName(raw, 1), optionName(raw, 2)];

    for (let variantIndex = 0; variantIndex < variants.length; variantIndex++) {
      const variant = variants[variantIndex];
      const variantRaw = variant.rawJson ?? null;
      const inv = variantRaw?.inventoryItem ?? null;
      const isFirst = variantIndex === 0;

      const row = emptyRow(allColumns);
      row.Handle = baseHandle;
      const numericProductId = (raw?.id ?? "").toString().split("/").pop() ?? "";
      const numericVariantId = (variantRaw?.id ?? "").toString().split("/").pop() ?? "";
      row["Variant ID"] = numericVariantId;
      if (isFirst) {
        row.ID = numericProductId;
        row.Title = product.title;
        row["Body (HTML)"] = product.bodyHtml;
        row.Vendor = product.vendor;
        row["Product Category"] = raw?.category?.fullName ?? raw?.category?.name ?? "";
        row.Type = product.productType;
        row.Tags = product.tags.join(", ");
        row.Published = product.status === "active" ? "TRUE" : "FALSE";
        row.Status = product.status;
        row["SEO Title"] = product.seoTitle;
        row["SEO Description"] = product.seoDescription;
        row["Gift Card"] = bool(raw?.isGiftCard ?? false);
        row["Product URL"] = baseHandle ? `https://${host}/products/${baseHandle}` : "";
        row["Admin URL"] = numericProductId
          ? `https://admin.shopify.com/store/${slug}/products/${numericProductId}`
          : "";

        // Fill product metafields only on the first variant row of each product.
        const productMetaByKey = new Map(product.metafields.map((mf) => [metafieldKeyOf(mf), mf]));
        for (const mf of productMetafields) {
          const raw = productMetaByKey.get(metafieldKeyOf(mf))?.value ?? "";
          row[metafieldColumnLabel("Product", mf)] = raw;
          if (isReferenceMetafield(mf.type)) {
            row[metafieldDisplayColumnLabel("Product", mf)] = resolvedDisplayValue(raw, mf.type, referenceLookup);
            row[metafieldRefColumnLabel("Product", mf)] = resolvedRefValue(raw, mf.type, portableLookup);
          }
        }
      }

      // Fan all image URLs across Image 1..N columns on EVERY variant row, so each
      // variant row is self-contained and easier to skim.
      for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
        row[`Image ${imageIndex + 1}`] = images[imageIndex]?.src ?? "";
      }

      // Variant metafields belong on each variant row.
      const variantMetaByKey = new Map(variant.metafields.map((mf) => [metafieldKeyOf(mf), mf]));
      for (const mf of variantMetafields) {
        const raw = variantMetaByKey.get(metafieldKeyOf(mf))?.value ?? "";
        row[metafieldColumnLabel("Variant", mf)] = raw;
        if (isReferenceMetafield(mf.type)) {
          row[metafieldDisplayColumnLabel("Variant", mf)] = resolvedDisplayValue(raw, mf.type, referenceLookup);
          row[metafieldRefColumnLabel("Variant", mf)] = resolvedRefValue(raw, mf.type, portableLookup);
        }
      }

      row["Option1 Name"] = variantOptionValue(variant, 1) ? optionNames[0] || "Title" : "";
      row["Option1 Value"] = variantOptionValue(variant, 1);
      row["Option2 Name"] = variantOptionValue(variant, 2) ? optionNames[1] || "" : "";
      row["Option2 Value"] = variantOptionValue(variant, 2) ?? "";
      row["Option3 Name"] = variantOptionValue(variant, 3) ? optionNames[2] || "" : "";
      row["Option3 Value"] = variantOptionValue(variant, 3) ?? "";

      row["Variant SKU"] = variant.sku ?? "";
      row["Variant Grams"] = weightInGrams(inv?.measurement?.weight ?? null);
      row["Variant Inventory Tracker"] = inv?.tracked ? "shopify" : "";
      row["Variant Inventory Qty"] = String(variant.inventoryQuantity ?? 0);
      row["Variant Inventory Policy"] = (variantRaw?.inventoryPolicy ?? "DENY").toLowerCase();
      row["Variant Fulfillment Service"] = "manual";
      row["Variant Price"] = variant.price !== null && variant.price !== undefined ? String(variant.price) : "";
      row["Variant Compare At Price"] =
        variant.compareAtPrice !== null && variant.compareAtPrice !== undefined ? String(variant.compareAtPrice) : "";
      row["Variant Requires Shipping"] = bool(inv?.requiresShipping ?? true);
      row["Variant Taxable"] = bool(variantRaw?.taxable ?? true);
      row["Variant Barcode"] = variant.barcode ?? "";

      row["Variant Image"] = variant.image ?? variantRaw?.image?.url ?? "";
      row["Variant Weight Unit"] = shopifyWeightUnit(inv?.measurement?.weight?.unit ?? null);
      row["Variant Tax Code"] = variantRaw?.taxCode ?? "";
      row["Cost per item"] = inv?.unitCost?.amount !== null && inv?.unitCost?.amount !== undefined
        ? String(inv.unitCost.amount)
        : "";
      row["Country of Origin"] = inv?.countryCodeOfOrigin ?? "";
      row["Harmonized System Code"] = inv?.harmonizedSystemCode ?? "";

      rows.push(row);
    }

  }

  const header = allColumns.map(escapeCsv).join(",");
  const body = rows.map((row) => allColumns.map((column) => escapeCsv(row[column] ?? "")).join(",")).join("\n");
  return `${header}\n${body}`;
}
