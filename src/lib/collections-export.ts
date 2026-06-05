// Shopify-style CSV export for collections + their metafields.
//
// Mirrors src/lib/export.ts (products): one row per collection, stable metafield
// columns discovered across the whole export, and `[display]`/`[ref]` companion
// columns for reference-type metafields so they survive a round-trip.

import type { ExportMetafield } from "@/lib/export";

export type ExportCollection = {
  // Numeric Shopify collection ID (last path segment of the GID).
  id: string;
  handle: string;
  title: string;
  bodyHtml: string;
  sortOrder: string;
  templateSuffix: string;
  isSmart: boolean;
  seoTitle: string;
  seoDescription: string;
  metafields: ExportMetafield[];
};

export type CollectionExportOptions = {
  shopDomain?: string;
  referenceLookup?: Map<string, string>;
  portableLookup?: Map<string, string>;
};

type CsvRow = Record<string, string>;

const STANDARD_COLUMNS = [
  "ID",
  "Handle",
  "Title",
  "Body (HTML)",
  "Sort Order",
  "Template Suffix",
  "Type",
  "SEO Title",
  "SEO Description",
  "Admin URL"
] as const;

function escapeCsv(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function adminSlug(shopDomain?: string): string {
  if (!shopDomain) return "your-store";
  return shopDomain.replace(/\.myshopify\.com$/i, "");
}

const REF_TYPE = /^(list\.)?(metaobject|product|variant|collection|file|page)_reference$/;
function isReferenceMetafield(type: string): boolean {
  return REF_TYPE.test(type);
}

function metafieldKeyOf(mf: ExportMetafield): string {
  return `${mf.namespace}.${mf.key}`;
}

function metafieldColumnLabel(mf: ExportMetafield): string {
  return `Collection Metafield: ${mf.namespace}.${mf.key} [${mf.type}]`;
}

function metafieldDisplayColumnLabel(mf: ExportMetafield): string {
  return `Collection Metafield: ${mf.namespace}.${mf.key} [display]`;
}

function metafieldRefColumnLabel(mf: ExportMetafield): string {
  return `Collection Metafield: ${mf.namespace}.${mf.key} [ref]`;
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

function emptyRow(columns: readonly string[]): CsvRow {
  return Object.fromEntries(columns.map((column) => [column, ""])) as CsvRow;
}

export function toCollectionsCsv(
  collections: ExportCollection[],
  options: CollectionExportOptions = {}
): string {
  const slug = adminSlug(options.shopDomain);
  const referenceLookup = options.referenceLookup ?? new Map<string, string>();
  const portableLookup = options.portableLookup ?? new Map<string, string>();

  // Discover unique metafield definitions across the whole export so columns are stable.
  const metaMap = new Map<string, ExportMetafield>();
  for (const collection of collections) {
    for (const mf of collection.metafields) metaMap.set(metafieldKeyOf(mf), mf);
  }
  const metafields = Array.from(metaMap.values()).sort((a, b) =>
    metafieldKeyOf(a).localeCompare(metafieldKeyOf(b))
  );

  const metaColumns: string[] = [];
  for (const mf of metafields) {
    metaColumns.push(metafieldColumnLabel(mf));
    if (isReferenceMetafield(mf.type)) {
      metaColumns.push(metafieldDisplayColumnLabel(mf));
      metaColumns.push(metafieldRefColumnLabel(mf));
    }
  }

  const allColumns = [...STANDARD_COLUMNS, ...metaColumns];
  const rows: CsvRow[] = [];

  for (const collection of collections) {
    const row = emptyRow(allColumns);
    row.ID = collection.id;
    row.Handle = collection.handle;
    row.Title = collection.title;
    row["Body (HTML)"] = collection.bodyHtml;
    row["Sort Order"] = collection.sortOrder;
    row["Template Suffix"] = collection.templateSuffix;
    row.Type = collection.isSmart ? "Smart" : "Custom";
    row["SEO Title"] = collection.seoTitle;
    row["SEO Description"] = collection.seoDescription;
    row["Admin URL"] = collection.id
      ? `https://admin.shopify.com/store/${slug}/collections/${collection.id}`
      : "";

    const byKey = new Map(collection.metafields.map((mf) => [metafieldKeyOf(mf), mf]));
    for (const mf of metafields) {
      const raw = byKey.get(metafieldKeyOf(mf))?.value ?? "";
      row[metafieldColumnLabel(mf)] = raw;
      if (isReferenceMetafield(mf.type)) {
        row[metafieldDisplayColumnLabel(mf)] = resolvedDisplayValue(raw, mf.type, referenceLookup);
        row[metafieldRefColumnLabel(mf)] = resolvedRefValue(raw, mf.type, portableLookup);
      }
    }

    rows.push(row);
  }

  const header = allColumns.map(escapeCsv).join(",");
  const body = rows.map((row) => allColumns.map((column) => escapeCsv(row[column] ?? "")).join(",")).join("\n");
  return `${header}\n${body}`;
}
