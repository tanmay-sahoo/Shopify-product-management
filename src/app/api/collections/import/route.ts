import { NextRequest, NextResponse } from "next/server";

import { parseCollectionsCsv } from "@/lib/collections-import-parser";
import { pushParsedCollections } from "@/lib/collections-push";
import { getActiveStoreIdOrThrow } from "@/lib/drafts";
import { ensureSchemaCompatibility } from "@/lib/schema-bootstrap";

// Synchronous parse + push. Collections are typically far fewer than products,
// so a single request is fine. Capped to keep one request bounded; larger sets
// can be split across files.
const MAX_ROWS = 1000;

export async function POST(request: NextRequest) {
  let storeId: number;
  try {
    await ensureSchemaCompatibility();
    storeId = await getActiveStoreIdOrThrow();
  } catch {
    return NextResponse.json({ error: "Connect a Shopify store before importing." }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload a CSV file" }, { status: 400 });
  }

  const contents = await file.text();
  const parsed = parseCollectionsCsv(contents);

  if (parsed.collections.length === 0) {
    return NextResponse.json({
      success: true,
      fileName: file.name,
      totals: { ok: 0, failed: 0, skipped: parsed.errors.length },
      parseErrors: parsed.errors,
      outcomes: []
    });
  }

  if (parsed.collections.length > MAX_ROWS) {
    return NextResponse.json(
      {
        error: `Too many rows (${parsed.collections.length}). Split the file into chunks of ${MAX_ROWS} or fewer.`
      },
      { status: 400 }
    );
  }

  const result = await pushParsedCollections(BigInt(storeId), parsed.collections);

  return NextResponse.json({
    success: true,
    fileName: file.name,
    totals: {
      ok: result.totals.ok,
      failed: result.totals.failed,
      skipped: parsed.errors.length
    },
    parseErrors: parsed.errors,
    outcomes: result.outcomes
  });
}
