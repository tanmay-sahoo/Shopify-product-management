import { NextRequest, NextResponse } from "next/server";

import { parseShopifyCsv } from "@/lib/import-parser";
import { getActiveStoreIdOrThrow } from "@/lib/drafts";
import { createImport, writeImportRows } from "@/lib/import-jobs";

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
  const parsed = parseShopifyCsv(contents);

  // Persist the upload + every parsed product, then return the new importId so
  // the UI can poll status as the user pushes.
  const importId = await createImport({
    storeId: BigInt(storeId),
    userId: null,
    fileName: file.name,
    totalRows: parsed.products.length,
    validRows: parsed.products.length,
    errorRows: parsed.errors.length,
    message:
      parsed.errors.length === 0
        ? `Parsed ${parsed.products.length} product(s).`
        : `Parsed ${parsed.products.length} product(s) — ${parsed.errors.length} parse error(s).`
  });
  await writeImportRows(importId, parsed.products);

  return NextResponse.json({
    success: true,
    item: {
      importId: importId.toString(),
      fileName: file.name,
      totalProducts: parsed.products.length,
      totalVariants: parsed.products.reduce((acc, p) => acc + p.variants.length, 0),
      totalImages: parsed.products.reduce((acc, p) => acc + p.images.length, 0),
      totalMetafields: parsed.products.reduce(
        (acc, p) => acc + p.metafields.length + p.variants.reduce((vAcc, v) => vAcc + v.metafields.length, 0),
        0
      ),
      errors: parsed.errors,
      products: parsed.products
    }
  });
}
