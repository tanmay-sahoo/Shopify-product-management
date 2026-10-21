// Parses a collections CSV for bulk partial-update. Keyed by Collection ID
// (one row per collection). Mirrors the product parser's partial-update rule:
// a field is only carried when its column exists AND the cell is non-empty —
// an empty cell means "leave alone", never "clear". That holds for the
// smart-collection rules too: an empty "Rules" cell never clears the rules a
// collection already has.

import { parseCollectionRules, parseRulesMatch, type CollectionRule } from "@/lib/collection-rules";
import { parseCsvRaw, type ParsedMetafield } from "@/lib/import-parser";

export type ParsedCollection = {
  rowNumber: number;
  // Numeric Shopify ID or full gid, as provided in the CSV. Empty when the row
  // is matched by handle instead (cross-shop restore).
  id: string;
  // True if the row provided an ID value (even if it failed to parse). When
  // false, the push matches by handle and creates the collection if missing.
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
  imageSrc?: string;
  imageAlt?: string;
  // Smart-collection conditions. undefined when the "Rules" cell was absent or
  // empty, so the push leaves the collection's existing rules alone.
  rules?: CollectionRule[];
  // From "Rules Match": false = all conditions, true = any. Undefined falls
  // back to "all" when rules are being written.
  rulesAppliedDisjunctively?: boolean;
  // From "Replace If Manual": the row's rules matter more than the existing
  // manual collection, so the push may delete and recreate it as smart.
  // Shopify has no manual->smart conversion, so this is the only way a
  // collection that already exists can end up with conditions.
  replaceIfManual?: boolean;
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
  const hasIdCol = headerIndex.has("id");
  const hasHandleCol = headerIndex.has("handle");
  if (!hasIdCol && !hasHandleCol) {
    return {
      collections: [],
      errors: [
        {
          row: 0,
          message:
            "Missing required ID or Handle column. Use ID to update collections in the same shop, " +
            "or Handle to update/create them in another shop."
        }
      ]
    };
  }

  // A "Rules Match" column with no "Rules" column beside it is almost always a
  // renamed or dropped column rather than intent — report it once, by name,
  // instead of repeating the same failure on every row.
  if (headerIndex.has("rules match") && !headerIndex.has("rules")) {
    return {
      collections: [],
      errors: [
        {
          row: 0,
          message:
            'Found a "Rules Match" column but no "Rules" column — smart-collection conditions go in a ' +
            `column named exactly "Rules". Columns found: ${headers.join(", ")}`
        }
      ]
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
    const handleCell = val(row, "Handle").trim();
    const idProvided = rawIdCell !== "";

    // A row is identified by ID (same-shop update) or, when no ID is present,
    // by Handle (cross-shop update/create).
    if (!idProvided && !handleCell) {
      errors.push({ row: rowNumber, message: "Missing Collection ID and Handle (need one to match the collection)" });
      return;
    }

    const normalizedId = idProvided ? normalizeId(rawIdCell) : "";
    if (idProvided && normalizedId === SCIENTIFIC_ID) {
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

    // Smart-collection rules. A malformed cell fails the row rather than
    // writing a half-understood rule set into Shopify.
    let rules: CollectionRule[] | undefined;
    const rulesCell = optional(row, "Rules");
    if (rulesCell !== undefined) {
      const parsed = parseCollectionRules(rulesCell);
      if (parsed.errors.length > 0) {
        errors.push({ row: rowNumber, message: `Rules: ${parsed.errors.join("; ")} (row skipped)` });
        return;
      }
      if (parsed.rules.length > 0) rules = parsed.rules;
    }

    const rulesMatchCell = optional(row, "Rules Match");
    let rulesAppliedDisjunctively: boolean | undefined;
    if (rulesMatchCell !== undefined) {
      rulesAppliedDisjunctively = parseRulesMatch(rulesMatchCell);
      if (rulesAppliedDisjunctively === undefined) {
        errors.push({
          row: rowNumber,
          message: `Rules Match "${rulesMatchCell}" must be "all" or "any" (row skipped)`
        });
        return;
      }
    }

    // "Rules Match" filled with an empty "Rules" cell means the author meant to
    // write conditions but none arrived — a stale download, a renamed column, a
    // row that ends before the Rules column. Pushing that row anyway creates or
    // leaves a manual collection and reports success, which is how a rule set
    // can be written in the sheet and silently never reach Shopify. Fail the
    // row instead so the reason is visible before anything is written.
    if (rules === undefined && rulesMatchCell !== undefined) {
      errors.push({
        row: rowNumber,
        message:
          `Rules Match is "${rulesMatchCell}" but the Rules cell is empty — no conditions to apply, ` +
          `so the collection would stay manual (row skipped)`
      });
      return;
    }

    // "Replace If Manual": opt-in, destructive. Only consulted when the row
    // also carries rules — on its own it does nothing.
    const replaceCell = optional(row, "Replace If Manual");
    let replaceIfManual: boolean | undefined;
    if (replaceCell !== undefined) {
      const v = replaceCell.toLowerCase();
      if (v === "yes" || v === "true" || v === "y" || v === "1") replaceIfManual = true;
      else if (v === "no" || v === "false" || v === "n" || v === "0") replaceIfManual = false;
      else {
        errors.push({
          row: rowNumber,
          message: `Replace If Manual "${replaceCell}" must be "yes" or "no" (row skipped)`
        });
        return;
      }
      if (replaceIfManual && rules === undefined) {
        errors.push({
          row: rowNumber,
          message:
            'Replace If Manual is "yes" but the row carries no Rules — there is nothing to recreate the ' +
            "collection as, so it would be deleted and rebuilt identical (row skipped)"
        });
        return;
      }
    }

    const collection: ParsedCollection = {
      rowNumber,
      id: normalizedId,
      idProvided,
      title: optional(row, "Title"),
      bodyHtml: optional(row, "Body (HTML)", "Body HTML"),
      handle: optional(row, "Handle"),
      sortOrder: optional(row, "Sort Order"),
      templateSuffix: optional(row, "Template Suffix"),
      seoTitle: optional(row, "SEO Title"),
      seoDescription: optional(row, "SEO Description"),
      imageSrc: optional(row, "Image Src", "Image"),
      imageAlt: optional(row, "Image Alt"),
      rules,
      rulesAppliedDisjunctively,
      replaceIfManual,
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
      collection.imageSrc !== undefined ||
      collection.rules !== undefined ||
      metafields.length > 0;
    if (!hasAnyField) {
      errors.push({
        row: rowNumber,
        message: `Collection ${normalizedId || handleCell} has no fields or metafields to update (row skipped)`
      });
      return;
    }

    collections.push(collection);
  });

  return { collections, errors };
}
