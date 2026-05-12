import { NextRequest, NextResponse } from "next/server";

import { getActiveStoreIdOrThrow } from "@/lib/drafts";
import { pushParsedProducts } from "@/lib/import-push";
import type { ParsedProduct } from "@/lib/import-parser";
import { getPrismaClient } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  let storeId: number;
  try {
    storeId = await getActiveStoreIdOrThrow();
  } catch {
    return NextResponse.json({ error: "Connect a Shopify store before importing." }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as { products?: ParsedProduct[]; fileName?: string } | null;
  if (!payload || !Array.isArray(payload.products) || payload.products.length === 0) {
    return NextResponse.json({ error: "No products in payload" }, { status: 400 });
  }

  const result = await pushParsedProducts(BigInt(storeId), payload.products);

  await getPrismaClient().syncLog.create({
    data: {
      storeId: BigInt(storeId),
      jobType: "csv-import.push",
      status: result.totals.failed === 0 ? "success" : result.totals.ok === 0 ? "failed" : "partial",
      message: `csv=${payload.fileName ?? "upload.csv"} ok=${result.totals.ok} failed=${result.totals.failed}`.slice(0, 500),
      startedAt: new Date(),
      completedAt: new Date()
    }
  });

  return NextResponse.json({ ok: result.totals.failed === 0, ...result });
}
