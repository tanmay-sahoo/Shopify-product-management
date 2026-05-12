import type { SyncMode } from "./types";

export type CsvRow = Record<string, string>;

const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;

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

export function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const cleaned = text.replace(/\r\n?/g, "\n").trim();
  if (!cleaned) return { headers: [], rows: [] };
  const lines = cleaned.split("\n").filter((line) => line.length > 0);
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: CsvRow = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? "").trim();
    });
    return row;
  });
  return { headers, rows };
}

function bool(value: string | undefined, defaultValue = true): boolean {
  if (value === undefined || value === "") return defaultValue;
  return /^(1|true|yes|y)$/i.test(value);
}

export type GroupDraft = {
  rowNumbers: number[];
  name: string;
  mode: SyncMode;
  syncStock: boolean;
  syncPrice: boolean;
  items: Array<{
    shopifyVariantId: string;
    role: "source" | "target" | "component" | "combo" | "member";
    quantityRequired?: number;
    stockBuffer?: number;
    priceMultiplier?: number;
    syncStock?: boolean;
    syncPrice?: boolean;
  }>;
};

export type ParseResult = {
  groups: GroupDraft[];
  errors: Array<{ row: number; message: string }>;
};

function ensureColumns(headers: string[], required: string[]): string | null {
  const missing = required.filter((r) => !headers.includes(r));
  return missing.length ? `Missing column(s): ${missing.join(", ")}` : null;
}

function validateGid(value: string, rowNumber: number, label: string, errors: ParseResult["errors"]): boolean {
  if (!VARIANT_GID.test(value)) {
    errors.push({ row: rowNumber, message: `${label} is not a valid ProductVariant GID: ${value}` });
    return false;
  }
  return true;
}

export function parseMirrorCsv(text: string): ParseResult {
  const { headers, rows } = parseCsv(text);
  const errors: ParseResult["errors"] = [];
  const headersMissing = ensureColumns(headers, ["group_name", "mode", "source_variant_id", "target_variant_id"]);
  if (headersMissing) return { groups: [], errors: [{ row: 0, message: headersMissing }] };

  const byGroup = new Map<string, GroupDraft>();
  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    if (row.mode !== "mirror") {
      errors.push({ row: rowNumber, message: `mode must be 'mirror', got '${row.mode}'` });
      return;
    }
    if (!row.group_name) {
      errors.push({ row: rowNumber, message: "group_name is required" });
      return;
    }
    const source = row.source_variant_id;
    const target = row.target_variant_id;
    if (!validateGid(source, rowNumber, "source_variant_id", errors)) return;
    if (!validateGid(target, rowNumber, "target_variant_id", errors)) return;
    if (source === target) {
      errors.push({ row: rowNumber, message: "source_variant_id and target_variant_id must differ" });
      return;
    }

    let draft = byGroup.get(row.group_name);
    if (!draft) {
      draft = {
        rowNumbers: [],
        name: row.group_name,
        mode: "mirror",
        syncStock: bool(row.sync_stock),
        syncPrice: bool(row.sync_price, false),
        items: [{ shopifyVariantId: source, role: "source" }]
      };
      byGroup.set(row.group_name, draft);
    }
    draft.rowNumbers.push(rowNumber);
    if (!draft.items.some((it) => it.role === "target" && it.shopifyVariantId === target)) {
      draft.items.push({
        shopifyVariantId: target,
        role: "target",
        stockBuffer: row.stock_buffer ? Number(row.stock_buffer) : 0,
        priceMultiplier: row.price_multiplier ? Number(row.price_multiplier) : 1,
        syncStock: bool(row.sync_stock),
        syncPrice: bool(row.sync_price, false)
      });
    }
  });

  return { groups: Array.from(byGroup.values()), errors };
}

export function parseSharedPoolCsv(text: string): ParseResult {
  const { headers, rows } = parseCsv(text);
  const errors: ParseResult["errors"] = [];
  const headersMissing = ensureColumns(headers, ["group_name", "mode", "variant_id"]);
  if (headersMissing) return { groups: [], errors: [{ row: 0, message: headersMissing }] };

  const byGroup = new Map<string, GroupDraft>();
  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    if (row.mode !== "shared_pool") {
      errors.push({ row: rowNumber, message: `mode must be 'shared_pool', got '${row.mode}'` });
      return;
    }
    if (!row.group_name) {
      errors.push({ row: rowNumber, message: "group_name is required" });
      return;
    }
    const variantId = row.variant_id;
    if (!validateGid(variantId, rowNumber, "variant_id", errors)) return;

    let draft = byGroup.get(row.group_name);
    if (!draft) {
      draft = {
        rowNumbers: [],
        name: row.group_name,
        mode: "shared_pool",
        syncStock: bool(row.sync_stock),
        syncPrice: bool(row.sync_price, false),
        items: []
      };
      byGroup.set(row.group_name, draft);
    }
    draft.rowNumbers.push(rowNumber);
    if (draft.items.some((it) => it.shopifyVariantId === variantId)) {
      errors.push({ row: rowNumber, message: `Variant ${variantId} appears twice in pool '${row.group_name}'` });
      return;
    }
    draft.items.push({
      shopifyVariantId: variantId,
      role: "member",
      syncStock: bool(row.sync_stock),
      syncPrice: bool(row.sync_price, false)
    });
  });

  return { groups: Array.from(byGroup.values()), errors };
}

export function parseBundleCsv(text: string): ParseResult {
  const { headers, rows } = parseCsv(text);
  const errors: ParseResult["errors"] = [];
  const headersMissing = ensureColumns(headers, ["group_name", "mode", "combo_variant_id", "component_variant_id", "quantity_required"]);
  if (headersMissing) return { groups: [], errors: [{ row: 0, message: headersMissing }] };

  const byGroup = new Map<string, GroupDraft>();
  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    if (row.mode !== "bundle") {
      errors.push({ row: rowNumber, message: `mode must be 'bundle', got '${row.mode}'` });
      return;
    }
    if (!row.group_name) {
      errors.push({ row: rowNumber, message: "group_name is required" });
      return;
    }
    const combo = row.combo_variant_id;
    const component = row.component_variant_id;
    if (!validateGid(combo, rowNumber, "combo_variant_id", errors)) return;
    if (!validateGid(component, rowNumber, "component_variant_id", errors)) return;
    if (combo === component) {
      errors.push({ row: rowNumber, message: "combo_variant_id and component_variant_id must differ" });
      return;
    }
    const qty = Number(row.quantity_required);
    if (!Number.isInteger(qty) || qty < 1) {
      errors.push({ row: rowNumber, message: "quantity_required must be a positive integer" });
      return;
    }

    let draft = byGroup.get(row.group_name);
    if (!draft) {
      draft = {
        rowNumbers: [],
        name: row.group_name,
        mode: "bundle",
        syncStock: true,
        syncPrice: false,
        items: [{ shopifyVariantId: combo, role: "combo" }]
      };
      byGroup.set(row.group_name, draft);
    }
    draft.rowNumbers.push(rowNumber);
    if (!draft.items.some((it) => it.role === "combo" && it.shopifyVariantId === combo)) {
      draft.items.push({ shopifyVariantId: combo, role: "combo" });
    }
    if (draft.items.some((it) => it.role === "component" && it.shopifyVariantId === component)) {
      errors.push({ row: rowNumber, message: `component ${component} appears twice in bundle '${row.group_name}'` });
      return;
    }
    draft.items.push({ shopifyVariantId: component, role: "component", quantityRequired: qty });
  });

  return { groups: Array.from(byGroup.values()), errors };
}

export function parseCsvForMode(mode: SyncMode, text: string): ParseResult {
  if (mode === "mirror") return parseMirrorCsv(text);
  if (mode === "shared_pool") return parseSharedPoolCsv(text);
  return parseBundleCsv(text);
}

export function exportGroupsCsv(
  groups: Array<{
    name: string;
    mode: SyncMode;
    syncStock: boolean;
    syncPrice: boolean;
    items: Array<{
      shopifyVariantId: string;
      role: string;
      quantityRequired: number;
      stockBuffer: number;
      priceMultiplier: number;
      syncStock: boolean;
      syncPrice: boolean;
    }>;
  }>
): { mirror: string; shared_pool: string; bundle: string } {
  const mirrorLines = ["group_name,mode,source_variant_id,target_variant_id,sync_stock,sync_price,stock_buffer,price_multiplier"];
  const poolLines = ["group_name,mode,variant_id,sync_stock,sync_price"];
  const bundleLines = ["group_name,mode,combo_variant_id,component_variant_id,quantity_required"];

  for (const g of groups) {
    if (g.mode === "mirror") {
      const source = g.items.find((it) => it.role === "source");
      if (!source) continue;
      for (const t of g.items.filter((it) => it.role === "target")) {
        mirrorLines.push(
          [g.name, g.mode, source.shopifyVariantId, t.shopifyVariantId, t.syncStock, t.syncPrice, t.stockBuffer, t.priceMultiplier].join(",")
        );
      }
    } else if (g.mode === "shared_pool") {
      for (const m of g.items) {
        poolLines.push([g.name, g.mode, m.shopifyVariantId, m.syncStock, m.syncPrice].join(","));
      }
    } else {
      const combos = g.items.filter((it) => it.role === "combo");
      for (const combo of combos) {
        for (const c of g.items.filter((it) => it.role === "component")) {
          bundleLines.push([g.name, g.mode, combo.shopifyVariantId, c.shopifyVariantId, c.quantityRequired].join(","));
        }
      }
    }
  }

  return { mirror: mirrorLines.join("\n"), shared_pool: poolLines.join("\n"), bundle: bundleLines.join("\n") };
}
