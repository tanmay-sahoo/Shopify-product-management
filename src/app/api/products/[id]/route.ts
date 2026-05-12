import { NextRequest, NextResponse } from "next/server";

import { createDraftChange } from "@/lib/drafts";
import { products } from "@/lib/mock-data";
import { getPrismaClient } from "@/lib/prisma";
import { productPatchSchema } from "@/lib/validation";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = products.find((item) => item.id === Number(id));

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  return NextResponse.json({ item: product });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = await request.json();
  const parsed = productPatchSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let beforeData: Record<string, unknown> | undefined;
  let afterData: Record<string, unknown> = { ...parsed.data };
  try {
    const existing = await getPrismaClient().product.findUnique({ where: { id: BigInt(id) } });
    if (existing) {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};

      const candidate = parsed.data;

      if (candidate.title !== undefined && candidate.title !== existing.title) {
        before.title = existing.title ?? "";
        after.title = candidate.title;
      }
      if (candidate.vendor !== undefined && candidate.vendor !== existing.vendor) {
        before.vendor = existing.vendor ?? "";
        after.vendor = candidate.vendor;
      }
      if (candidate.productType !== undefined && candidate.productType !== existing.productType) {
        before.productType = existing.productType ?? "";
        after.productType = candidate.productType;
      }
      if (candidate.status !== undefined && candidate.status !== existing.status) {
        before.status = existing.status;
        after.status = candidate.status;
      }
      if (candidate.tags !== undefined) {
        const beforeTags = (existing.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
        const afterTags = (candidate.tags ?? []).map((t) => t.trim()).filter(Boolean);
        if (beforeTags.join(",") !== afterTags.join(",")) {
          before.tags = beforeTags;
          after.tags = afterTags;
        }
      }
      if (candidate.seoTitle !== undefined && candidate.seoTitle !== existing.seoTitle) {
        before.seoTitle = existing.seoTitle ?? "";
        after.seoTitle = candidate.seoTitle;
      }
      if (
        candidate.seoDescription !== undefined &&
        candidate.seoDescription !== existing.seoDescription
      ) {
        before.seoDescription = existing.seoDescription ?? "";
        after.seoDescription = candidate.seoDescription;
      }

      if (Object.keys(after).length === 0) {
        return NextResponse.json({
          success: true,
          noChange: true,
          message: "No changes detected — the values you submitted already match the current product."
        });
      }

      beforeData = before;
      afterData = after;
    }
  } catch (error) {
    console.error("[PATCH /api/products/[id]] beforeData lookup failed:", error);
  }

  try {
    const draft = await createDraftChange({
      entityType: "product",
      entityId: Number(id),
      changeType: "update",
      beforeData,
      afterData
    });
    return NextResponse.json({
      success: true,
      item: { id: Number(id), ...parsed.data },
      draftCreated: true,
      draftId: Number(draft.id),
      changedFields: Object.keys(afterData)
    });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_ACTIVE_STORE") {
      return NextResponse.json(
        { error: "Connect a Shopify store before staging changes." },
        { status: 400 }
      );
    }
    console.error("[PATCH /api/products/[id]] draft create failed:", error);
    return NextResponse.json({ error: "Failed to stage change." }, { status: 500 });
  }
}
