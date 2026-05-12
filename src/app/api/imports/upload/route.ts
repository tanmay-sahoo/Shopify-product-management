import { NextRequest, NextResponse } from "next/server";

import { parseShopifyCsv } from "@/lib/import-parser";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload a CSV file" }, { status: 400 });
  }

  const contents = await file.text();
  const parsed = parseShopifyCsv(contents);

  return NextResponse.json({
    success: true,
    item: {
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
