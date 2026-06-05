// Parses a collections CSV for bulk partial-update. Keyed by Collection ID
// (one row per collection). Mirrors the product parser's partial-update rule:
// a field is only carried when its column exists AND the cell is non-empty —
// an empty cell means "leave alone", never "clear". Smart-collection rules are
// never represented here, so they can never be touched.

import { parseCsvRaw, type ParsedMetafield } from "@/lib/import-parser";

export type ParsedCollection = {
  rowNumber: number;
  // Numeric Shopify ID or full gid, as provided in the CSV.
  id: string;
  // True if the row provided an ID value (even if it failed to parse).
  idProvided: boolean;
  // Optional fields — undefined means the column was absent or empty, so the
  // push leaves that field untouched.
  title?: string;
  bodyHtml?: string;
  handle?: string;
  sortOrder?: string;
  templateSuffix?: string;
  seoTitle?: string;
  seoDescription?: string;
  metafields: ParsedMetafield[];
};

export type CollectionParseResult = {
  collections: ParsedCollection[];
  errors: Array<{ row: number; message: string }>;
};

const METAFIELD_HEADER = /^\s*Collection\s+Metafield:\s*(.+?)\.(.+?)\s*\[(.+?)\]\s*$/i;
const REF_SUFFIX = /^(display|ref)$/i;

// Excel mangles long numeric Shopify IDs into scientific notation
// (1234567890123 → "1.23E+12"). Flag that so we can emit a clear error.
const SCIENTIFIC_ID = "__SCIENTIFIC_NOTATION__";
function normalizeId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("gid://")) return trimmed;
  if (/^\d+$/.test(trimmed)) return trimmed;
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(trimmed)) return SCIENTIFIC_ID;
  return trimmed;
}

export function parseCollectionsCsv(text: string): CollectionParseResult {
  const { headers, rows } = parseCsvRaw(text);
  const errors: CollectionParseResult["errors"] = [];

  if (headers.length === 0) {
    return { collections: [], errors: [{ row: 0, message: "Empty CSV" }] };
  }

  const headerIndex = new Map<string, number>();
  headers.forEach((h, i) => headerIndex.set(h.toLowerCase(), i));
  const hasId = headerIndex.has("id");
  if (!hasId) {
    return {
      collections: [],
      errors: [{ row: 0, message: "Missing required ID column (collections are matched by Collection ID)" }]
    };
  }

  function val(row: string[], name: string): string {
    const i = headerIndex.get(name.toLowerCase());
    return i !== undefined ? (row[i] ?? "") : "";
  }
  // Returns undefined when the column is absent OR the cell is empty (so the
  // field is left untouched), otherwise the trimmed value.
  function optional(row: string[], ...names: string[]): string | undefined {
    for (const name of names) {
      const i = headerIndex.get(name.toLowerCase());
      if (i === undefined) continue;
      const raw = (row[i] ?? "").trim();
      if (raw !== "") return raw;
    }
    return undefined;
  }

  // Discover collection metafield columns and their [ref] companions.
  const metafieldCols: Array<{ namespace: string; key: string; type: string; index: number }> = [];
  const refColByKey = new Map<string, number>();
  headers.forEach((h, i) => {
    const match = h.match(METAFIELD_HEADER);
    if (!match) return;
    const namespace = match[1].trim();
    const key = match[2].trim();
    const typeOrSuffix = match[3].trim();
    if (REF_SUFFIX.test(typeOrSuffix)) {
      if (typeOrSuffix.toLowerCase() === "ref") refColByKey.set(`${namespace}.${key}`, i);
      // [display] columns are humans-only; ignore on import.
    } else {
      metafieldCols.push({ namespace, key, type: typeOrSuffix, index: i });
    }
  });

  const collections: ParsedCollection[] = [];

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2; // 1-indexed + header row
    if (row.every((cell) => cell.trim() === "")) return; // trailing blank line

    const rawIdCell = val(row, "ID").trim();
    const idProvided = rawIdCell !== "";
    const normalizedId = normalizeId(rawIdCell);

    if (!idProvided) {
      errors.push({ row: rowNumber, message: "Missing Collection ID" });
      return;
    }
    if (normalizedId === SCIENTIFIC_ID) {
      errors.push({
        row: rowNumber,
        message:
          `ID column has scientific notation (e.g. "1.58E+13") — Excel rounded the value. ` +
          `Re-open the CSV in Google Sheets, or format the ID column as Text before saving.`
      });
      return;
    }

    const metafields: ParsedMetafield[] = [];
    for (const col of metafieldCols) {
      const value = row[col.index] ?? "";
      if (value.trim() === "") continue;
      const refIdx = refColByKey.get(`${col.namespace}.${col.key}`);
      const ref = refIdx !== undefined ? (row[refIdx] ?? "").trim() : "";
      metafields.push({
        namespace: col.namespace,
        key: col.key,
        type: col.type,
        value,
        ref: ref || undefined
      });
    }

    const collection: ParsedCollection = {
      rowNumber,
      id: normalizedId,
      idProvided: true,
      title: optional(row, "Title"),
      bodyHtml: optional(row, "Body (HTML)", "Body HTML"),
      handle: optional(row, "Handle"),
      sortOrder: optional(row, "Sort Order"),
      templateSuffix: optional(row, "Template Suffix"),
      seoTitle: optional(row, "SEO Title"),
      seoDescription: optional(row, "SEO Description"),
      metafields
    };

    // A row with only an ID and no fields/metafields would be a no-op — flag it
    // so the operator notices an empty edit rather than silently doing nothing.
    const hasAnyField =
      collection.title !== undefined ||
      collection.bodyHtml !== undefined ||
      collection.handle !== undefined ||
      collection.sortOrder !== undefined ||
      collection.templateSuffix !== undefined ||
      collection.seoTitle !== undefined ||
      collection.seoDescription !== undefined ||
      metafields.length > 0;
    if (!hasAnyField) {
      errors.push({
        row: rowNumber,
        message: `Collection ${normalizedId} has no fields or metafields to update (row skipped)`
      });
      return;
    }

    collections.push(collection);
  });

  return { collections, errors };
}
