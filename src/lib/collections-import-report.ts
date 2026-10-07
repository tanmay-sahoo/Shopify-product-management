// Builds the Success / Errors CSV for a collections import job, re-emitting the
// stored ParsedCollection rows so an operator can fix and re-upload. Mirrors the
// product import report routes but with collection columns.

import { Prisma } from "@prisma/client";

import { formatCollectionRules, formatRulesMatch, type CollectionRule } from "@/lib/collection-rules";
import { getPrismaClient } from "@/lib/prisma";
import { ensureSchemaCompatibility } from "@/lib/schema-bootstrap";

type StoredCollection = {
  id?: string;
  handle?: string;
  title?: string;
  bodyHtml?: string;
  sortOrder?: string;
  templateSuffix?: string;
  seoTitle?: string;
  seoDescription?: string;
  imageSrc?: string;
  imageAlt?: string;
  rules?: CollectionRule[];
  rulesAppliedDisjunctively?: boolean;
};

function escape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

const FIELD_HEADERS = [
  "ID",
  "Title",
  "Handle",
  "Body (HTML)",
  "Sort Order",
  "Template Suffix",
  "SEO Title",
  "SEO Description",
  "Image Src",
  "Image Alt",
  "Rules Match",
  "Rules"
];

export async function buildCollectionsReportCsv(
  importId: bigint,
  kind: "ok" | "error"
): Promise<string> {
  await ensureSchemaCompatibility();
  const db = getPrismaClient();
  const status = kind === "ok" ? "ok" : "error";
  const rows = await db.$queryRaw<{ sku: string | null; pushError: string | null; rowData: Prisma.JsonValue }[]>(
    Prisma.sql`SELECT sku, pushError, rowData FROM \`ImportRow\`
               WHERE importId = ${importId} AND pushStatus = ${status}
               ORDER BY rowNumber ASC`
  );

  // Successful rows can still carry a warning (rules refused, references
  // skipped) — pushError holds it for ok rows, so give it a column.
  const headers = kind === "error" ? ["Error", ...FIELD_HEADERS] : ["Warning", ...FIELD_HEADERS];
  const lines: string[] = [headers.map(escape).join(",")];

  for (const row of rows) {
    const c = (row.rowData ?? {}) as unknown as StoredCollection;
    // sku column carries the Collection ID for collections imports.
    const id = c.id ?? row.sku ?? "";
    const fields = [
      id,
      c.title ?? "",
      c.handle ?? "",
      c.bodyHtml ?? "",
      c.sortOrder ?? "",
      c.templateSuffix ?? "",
      c.seoTitle ?? "",
      c.seoDescription ?? "",
      c.imageSrc ?? "",
      c.imageAlt ?? "",
      // Re-emit the rules so a fixed row can be re-uploaded without losing them.
      c.rules && c.rules.length > 0
        ? formatRulesMatch({ appliedDisjunctively: Boolean(c.rulesAppliedDisjunctively), rules: c.rules })
        : "",
      c.rules && c.rules.length > 0
        ? formatCollectionRules({ appliedDisjunctively: Boolean(c.rulesAppliedDisjunctively), rules: c.rules })
        : ""
    ];
    const values = [row.pushError ?? "", ...fields];
    lines.push(values.map(escape).join(","));
  }

  return lines.join("\n");
}
