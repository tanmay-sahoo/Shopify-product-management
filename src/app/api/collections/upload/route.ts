import { NextRequest, NextResponse } from "next/server";

import { parseCollectionsCsv } from "@/lib/collections-import-parser";
import { getActiveStoreIdOrThrow } from "@/lib/drafts";
import { createImport, writeCollectionImportRows } from "@/lib/import-jobs";

// Parses a collections CSV and persists it as an Import job (importType =
// collections) so it flows through the same push / status / history / CSV-report
// infrastructure as product imports. The actual push is started separately via
// POST /api/imports/:id/push.
export async function POST(request: NextRequest) {
  let storeId: number;
  try {
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

  const importId = await createImport({
    storeId: BigInt(storeId),
    userId: null,
    fileName: file.name,
    importType: "collections",
    totalRows: parsed.collections.length,
    validRows: parsed.collections.length,
    errorRows: parsed.errors.length,
    message:
      parsed.errors.length === 0
        ? `Parsed ${parsed.collections.length} collection(s).`
        : `Parsed ${parsed.collections.length} collection(s) — ${parsed.errors.length} skipped row(s).`
  });
  await writeCollectionImportRows(importId, parsed.collections);

  return NextResponse.json({
    success: true,
    item: {
      importId: importId.toString(),
      fileName: file.name,
      totalCollections: parsed.collections.length,
      totalMetafields: parsed.collections.reduce((acc, c) => acc + c.metafields.length, 0),
      errors: parsed.errors
    }
  });
}
