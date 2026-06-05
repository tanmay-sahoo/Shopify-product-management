// Builds the Success / Errors CSV for a collections import job, re-emitting the
// stored ParsedCollection rows so an operator can fix and re-upload. Mirrors the
// product import report routes but with collection columns.

import { Prisma } from "@prisma/client";

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
  "SEO Description"
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

  const headers = kind === "error" ? ["Error", ...FIELD_HEADERS] : FIELD_HEADERS;
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
      c.seoDescription ?? ""
    ];
    const values = kind === "error" ? [row.pushError ?? "", ...fields] : fields;
    lines.push(values.map(escape).join(","));
  }

  return lines.join("\n");
}
