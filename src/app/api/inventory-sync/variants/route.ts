import { NextRequest, NextResponse } from "next/server";

import { getActiveStoreIdOrThrow } from "@/lib/drafts";
import { getPrismaClient } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const storeId = await getActiveStoreIdOrThrow();
    const url = request.nextUrl;
    const search = (url.searchParams.get("search") ?? "").trim();
    const take = Math.min(100, Number(url.searchParams.get("limit") ?? 50));

    const where: Record<string, unknown> = { storeId: BigInt(storeId), NOT: { shopifyVariantId: null } };
    if (search) {
      where.OR = [
        { sku: { contains: search } },
        { title: { contains: search } },
        { product: { is: { title: { contains: search } } } }
      ];
    }

    const variants = await getPrismaClient().variant.findMany({
      where,
      take,
      orderBy: { updatedAt: "desc" },
      include: { product: { select: { title: true, handle: true, productImages: { take: 1, orderBy: { position: "asc" } } } } }
    });

    return NextResponse.json({
      ok: true,
      variants: variants.map((v) => ({
        shopifyVariantId: v.shopifyVariantId,
        shopifyProductId: null,
        inventoryItemId: v.inventoryItemId,
        sku: v.sku,
        title: v.title,
        option1: v.option1Value,
        option2: v.option2Value,
        option3: v.option3Value,
        price: v.price ? Number(v.price) : null,
        inventoryQuantity: v.inventoryQuantity,
        productTitle: v.product.title,
        productHandle: v.product.handle,
        productImage: v.product.productImages[0]?.sourceUrl ?? null
      }))
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
