import { Prisma } from "@prisma/client";

import { buildCollectionsReportCsv } from "@/lib/collections-import-report";
import { getPrismaClient } from "@/lib/prisma";
import { getImport } from "@/lib/import-jobs";
import { ensureSchemaCompatibility } from "@/lib/schema-bootstrap";

function csvAttachment(body: string, fileName: string, suffix: string): Response {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/\.csv$/i, "");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}-${suffix}.csv"`
    }
  });
}

// Re-emit a CSV of every failed product row from this import, so the operator
// can fix and re-upload. We persist the parsed product as JSON, so we flatten
// the variant rows back to one CSV row per variant and add an Error column
// describing why each row failed.

function escape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

type StoredVariant = {
  sku?: string;
  option1Value?: string;
  option2Value?: string | null;
  option3Value?: string | null;
  price?: string;
  compareAtPrice?: string;
  inventoryQuantity?: string;
  barcode?: string;
  variantImage?: string;
  weightGrams?: string;
  inventoryPolicy?: string;
  requiresShipping?: string;
  taxable?: string;
  costPerItem?: string;
  countryOfOrigin?: string;
  harmonizedSystemCode?: string;
  inventoryTracker?: string;
};

type StoredProduct = {
  handle: string;
  title?: string;
  bodyHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  status?: string;
  seoTitle?: string;
  seoDescription?: string;
  option1Name?: string;
  option2Name?: string;
  option3Name?: string;
  variants?: StoredVariant[];
  images?: Array<{ src: string }>;
};

const HEADERS = [
  "Error",
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Type",
  "Tags",
  "Published",
  "Status",
  "Option1 Name",
  "Option1 Value",
  "Option2 Name",
  "Option2 Value",
  "Option3 Name",
  "Option3 Value",
  "Variant SKU",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Inventory Qty",
  "Variant Barcode",
  "Variant Image",
  "Variant Grams",
  "Variant Inventory Policy",
  "Variant Requires Shipping",
  "Variant Taxable",
  "Variant Inventory Tracker",
  "Cost per item",
  "Country of Origin",
  "Harmonized System Code",
  "SEO Title",
  "SEO Description",
  "Image Src"
];

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const importId = Number(id);
  if (!Number.isInteger(importId) || importId <= 0) {
    return new Response("Invalid import id", { status: 400 });
  }
  const job = await getImport(BigInt(importId));
  if (!job) return new Response("Not found", { status: 404 });

  await ensureSchemaCompatibility();

  if (job.importType === "collections") {
    const csv = await buildCollectionsReportCsv(BigInt(importId), "error");
    return csvAttachment(csv, job.fileName ?? `import-${importId}`, "errors");
  }

  const db = getPrismaClient();
  const rows = await db.$queryRaw<
    { handle: string | null; pushError: string | null; rowData: Prisma.JsonValue }[]
  >(
    Prisma.sql`SELECT handle, pushError, rowData FROM \`ImportRow\`
               WHERE importId = ${BigInt(importId)} AND pushStatus = 'error'
               ORDER BY rowNumber ASC`
  );

  const csvLines: string[] = [HEADERS.map(escape).join(",")];
  for (const row of rows) {
    const product = (row.rowData ?? {}) as unknown as StoredProduct;
    const error = row.pushError ?? "";
    const variants = product.variants && product.variants.length > 0 ? product.variants : [{} as StoredVariant];
    const firstImage = product.images?.[0]?.src ?? "";
    variants.forEach((variant, idx) => {
      const isFirst = idx === 0;
      const values = [
        isFirst ? error : "",
        product.handle ?? "",
        isFirst ? product.title ?? "" : "",
        isFirst ? product.bodyHtml ?? "" : "",
        isFirst ? product.vendor ?? "" : "",
        isFirst ? product.productType ?? "" : "",
        isFirst ? (product.tags ?? []).join(", ") : "",
        isFirst ? ((product.status ?? "active") === "active" ? "TRUE" : "FALSE") : "",
        isFirst ? product.status ?? "" : "",
        product.option1Name ?? "",
        variant.option1Value ?? "",
        product.option2Name ?? "",
        variant.option2Value ?? "",
        product.option3Name ?? "",
        variant.option3Value ?? "",
        variant.sku ?? "",
        variant.price ?? "",
        variant.compareAtPrice ?? "",
        variant.inventoryQuantity ?? "",
        variant.barcode ?? "",
        variant.variantImage ?? "",
        variant.weightGrams ?? "",
        variant.inventoryPolicy ?? "",
        variant.requiresShipping ?? "",
        variant.taxable ?? "",
        variant.inventoryTracker ?? "",
        variant.costPerItem ?? "",
        variant.countryOfOrigin ?? "",
        variant.harmonizedSystemCode ?? "",
        isFirst ? product.seoTitle ?? "" : "",
        isFirst ? product.seoDescription ?? "" : "",
        isFirst ? firstImage : ""
      ];
      csvLines.push(values.map(escape).join(","));
    });
  }

  const body = csvLines.join("\n");
  const safeName = (job.fileName ?? `import-${importId}`).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName.replace(/\.csv$/i, "")}-errors.csv"`
    }
  });
}
