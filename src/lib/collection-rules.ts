// Smart-collection rules (the "conditions" of an automated collection) in a
// CSV-friendly text form, shared by the collections export and import.
//
// Wire format — one rule per line inside a single "Rules" cell:
//
//   TAG:EQUALS:sale
//   VARIANT_PRICE:LESS_THAN:49.99
//   PRODUCT_METAFIELD_DEFINITION[custom.material]:EQUALS:cotton
//
// Only the first two colons are separators, so a condition may itself contain
// colons (taxonomy GIDs, URLs, times). Metafield-definition rules carry the
// definition as `[namespace.key]` on the column — portable across shops, where
// the raw definition GID would not be.
//
// The companion "Rules Match" cell holds `all` (Shopify: appliedDisjunctively
// false) or `any` (true).

export type CollectionRule = {
  column: string;
  relation: string;
  condition: string;
  // Only for PRODUCT_METAFIELD_DEFINITION / VARIANT_METAFIELD_DEFINITION.
  definitionKey?: string;
};

export type CollectionRuleSet = {
  appliedDisjunctively: boolean;
  rules: CollectionRule[];
};

// CollectionRuleColumn / CollectionRuleRelation as of Admin API 2025-10.
// Unknown values are rejected on import so a typo fails loudly in the parser
// instead of producing a wrong rule in Shopify.
const RULE_COLUMNS = [
  "IS_PRICE_REDUCED",
  "PRODUCT_CATEGORY_ID",
  "PRODUCT_METAFIELD_DEFINITION",
  "PRODUCT_TAXONOMY_NODE_ID",
  "TAG",
  "TITLE",
  "TYPE",
  "VARIANT_COMPARE_AT_PRICE",
  "VARIANT_INVENTORY",
  "VARIANT_METAFIELD_DEFINITION",
  "VARIANT_PRICE",
  "VARIANT_TITLE",
  "VARIANT_WEIGHT",
  "VENDOR"
] as const;

const RULE_RELATIONS = [
  "CONTAINS",
  "ENDS_WITH",
  "EQUALS",
  "GREATER_THAN",
  "IS_NOT_SET",
  "IS_SET",
  "LESS_THAN",
  "NOT_CONTAINS",
  "NOT_EQUALS",
  "STARTS_WITH"
] as const;

const COLUMN_SET = new Set<string>(RULE_COLUMNS);
const RELATION_SET = new Set<string>(RULE_RELATIONS);

export function isMetafieldRuleColumn(column: string): boolean {
  return column === "PRODUCT_METAFIELD_DEFINITION" || column === "VARIANT_METAFIELD_DEFINITION";
}

/** Owner type to look the definition up under in the destination shop. */
export function metafieldRuleOwnerType(column: string): "PRODUCT" | "PRODUCTVARIANT" {
  return column === "VARIANT_METAFIELD_DEFINITION" ? "PRODUCTVARIANT" : "PRODUCT";
}

function formatRule(rule: CollectionRule): string {
  const column = rule.definitionKey ? `${rule.column}[${rule.definitionKey}]` : rule.column;
  return `${column}:${rule.relation}:${rule.condition}`;
}

/** Renders a rule set into the multi-line "Rules" cell. */
export function formatCollectionRules(ruleSet: CollectionRuleSet | null): string {
  if (!ruleSet || ruleSet.rules.length === 0) return "";
  return ruleSet.rules.map(formatRule).join("\n");
}

export function formatRulesMatch(ruleSet: CollectionRuleSet | null): string {
  if (!ruleSet || ruleSet.rules.length === 0) return "";
  return ruleSet.appliedDisjunctively ? "any" : "all";
}

/**
 * `all` / `any` (also accepts `and` / `or`) → appliedDisjunctively.
 * Returns undefined when the cell is empty or unrecognized.
 */
export function parseRulesMatch(value: string): boolean | undefined {
  const v = value.trim().toLowerCase();
  if (v === "all" || v === "and") return false;
  if (v === "any" || v === "or") return true;
  return undefined;
}

const COLUMN_WITH_DEFINITION = /^([A-Za-z0-9_]+)\s*(?:\[\s*([^\]]+?)\s*\])?$/;

export type RulesParseResult = { rules: CollectionRule[]; errors: string[] };

/** Parses a "Rules" cell. Blank lines are ignored; every bad line is reported. */
export function parseCollectionRules(cell: string): RulesParseResult {
  const rules: CollectionRule[] = [];
  const errors: string[] = [];

  const lines = cell
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  for (const line of lines) {
    // Only the first two colons separate fields — the condition keeps the rest.
    const first = line.indexOf(":");
    const second = first === -1 ? -1 : line.indexOf(":", first + 1);
    if (first === -1 || second === -1) {
      errors.push(`rule "${line}" is not in COLUMN:RELATION:condition form`);
      continue;
    }

    const rawColumn = line.slice(0, first).trim();
    const relation = line.slice(first + 1, second).trim().toUpperCase();
    const condition = line.slice(second + 1).trim();

    const columnMatch = rawColumn.match(COLUMN_WITH_DEFINITION);
    if (!columnMatch) {
      errors.push(`rule "${line}" has an unreadable column "${rawColumn}"`);
      continue;
    }
    const column = columnMatch[1].toUpperCase();
    const definitionKey = columnMatch[2]?.trim();

    if (!COLUMN_SET.has(column)) {
      errors.push(`rule column "${rawColumn}" is not a Shopify rule column (allowed: ${RULE_COLUMNS.join(", ")})`);
      continue;
    }
    if (!RELATION_SET.has(relation)) {
      errors.push(`rule relation "${relation}" is not a Shopify rule relation (allowed: ${RULE_RELATIONS.join(", ")})`);
      continue;
    }

    if (isMetafieldRuleColumn(column)) {
      if (!definitionKey) {
        errors.push(`rule "${line}" needs the metafield definition as ${column}[namespace.key]`);
        continue;
      }
      if (!/^[^.\s]+\.[^.\s]+$/.test(definitionKey)) {
        errors.push(`metafield definition "${definitionKey}" must be in namespace.key form`);
        continue;
      }
    } else if (definitionKey) {
      errors.push(`rule column "${column}" does not take a [namespace.key] definition`);
      continue;
    }

    const needsCondition = relation !== "IS_SET" && relation !== "IS_NOT_SET";
    if (needsCondition && condition === "") {
      errors.push(`rule "${line}" has an empty condition`);
      continue;
    }

    rules.push({ column, relation, condition, definitionKey });
  }

  return { rules, errors };
}

type RawRuleNode = {
  column?: string | null;
  relation?: string | null;
  condition?: string | null;
  conditionObject?: {
    metafieldDefinition?: { namespace?: string | null; key?: string | null } | null;
  } | null;
};

/**
 * Pulls the rule set out of the stored `Collection.rawShopifyJson` snapshot, so
 * the export needs no extra Shopify call.
 *
 * `rawShopifyJson` is a MySQL JSON column, so Prisma hands it back already
 * parsed as an object — but raw queries elsewhere may hand over a string.
 * Accept either.
 *
 * Rows synced before `conditionObject` was added to the sync query have no
 * definition for metafield rules; those come back without `definitionKey` and
 * the CSV cell will show the rule as un-importable until the next sync.
 */
type RawCollectionNode = {
  ruleSet?: { appliedDisjunctively?: boolean; rules?: RawRuleNode[] } | null;
};

export function ruleSetFromRawJson(raw: unknown): CollectionRuleSet | null {
  if (!raw) return null;
  let node: RawCollectionNode | null = null;
  if (typeof raw === "string") {
    try {
      node = JSON.parse(raw) as RawCollectionNode;
    } catch {
      return null;
    }
  } else if (typeof raw === "object") {
    node = raw as RawCollectionNode;
  } else {
    return null;
  }
  const ruleSet = node?.ruleSet;
  if (!ruleSet || !Array.isArray(ruleSet.rules) || ruleSet.rules.length === 0) return null;

  const rules: CollectionRule[] = [];
  for (const rule of ruleSet.rules) {
    const column = (rule?.column ?? "").toUpperCase();
    const relation = (rule?.relation ?? "").toUpperCase();
    if (!column || !relation) continue;
    const definition = rule?.conditionObject?.metafieldDefinition;
    const definitionKey =
      definition?.namespace && definition?.key ? `${definition.namespace}.${definition.key}` : undefined;
    rules.push({ column, relation, condition: rule?.condition ?? "", definitionKey });
  }
  if (rules.length === 0) return null;

  return { appliedDisjunctively: Boolean(ruleSet.appliedDisjunctively), rules };
}
