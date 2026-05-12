import { NextRequest, NextResponse } from "next/server";

import { createDraftChange, createDraftChanges, type DraftInput } from "@/lib/drafts";
import { products } from "@/lib/mock-data";
import { getPrismaClient } from "@/lib/prisma";
import { productPatchSchema } from "@/lib/validation";

type IncomingVariant = {
  id?: number | string;
  sku?: string;
  option1Value?: string;
  option2Value?: string;
  option3Value?: string;
  price?: number | null;
  compareAtPrice?: number | null;
  inventoryQuantity?: number | null;
  barcode?: string;
  image?: string;
};

const VARIANT_FIELDS = [
  "sku",
  "option1Value",
  "option2Value",
  "option3Value",
  "price",
  "compareAtPrice",
  "inventoryQuantity",
  "barcode"
] as const;

function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  return String(value).trim();
}

function diffVariant(
  existing: Record<string, unknown>,
  incoming: IncomingVariant
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of VARIANT_FIELDS) {
    const next = (incoming as Record<string, unknown>)[key];
    if (next === undefined) continue;
    const prev = (existing as Record<string, unknown>)[key];
    if (normalise(prev) !== normalise(next)) {
      before[key] = prev ?? null;
      after[key] = next ?? null;
    }
  }
  return { before, after };
}

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
  const rawPayload = await request.json();
  const { variants: incomingVariants, ...productOnly } = rawPayload ?? {};
  const parsed = productPatchSchema.safeParse(productOnly);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let productBefore: Record<string, unknown> | undefined;
  let productAfter: Record<string, unknown> = { ...parsed.data };
  const variantDrafts: DraftInput[] = [];
  const changedVariantFields: { variantId: number; fields: string[] }[] = [];
  let productChangedFields: string[] = Object.keys(productAfter);

  const prisma = getPrismaClient();
  let existing;
  try {
    existing = await prisma.product.findUnique({
      where: { id: BigInt(id) },
      include: { variants: true }
    });
  } catch (error) {
    console.error("[PATCH /api/products/[id]] product lookup failed:", error);
    existing = null;
  }

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

    productBefore = before;
    productAfter = after;
    productChangedFields = Object.keys(after);

    if (Array.isArray(incomingVariants)) {
      const variantsById = new Map<number, (typeof existing.variants)[number]>();
      for (const v of existing.variants) variantsById.set(Number(v.id), v);

      for (const incoming of incomingVariants as IncomingVariant[]) {
        const variantIdNum = incoming.id !== undefined ? Number(incoming.id) : NaN;
        const existingVariant = Number.isFinite(variantIdNum) ? variantsById.get(variantIdNum) : undefined;
        if (!existingVariant) continue;

        const existingAsRecord: Record<string, unknown> = {
          sku: existingVariant.sku,
          option1Value: existingVariant.option1Value,
          option2Value: existingVariant.option2Value,
          option3Value: existingVariant.option3Value,
          price: existingVariant.price === null ? null : Number(existingVariant.price),
          compareAtPrice:
            existingVariant.compareAtPrice === null ? null : Number(existingVariant.compareAtPrice),
          inventoryQuantity: existingVariant.inventoryQuantity,
          barcode: existingVariant.barcode
        };
        const { before: vb, after: va } = diffVariant(existingAsRecord, incoming);
        if (Object.keys(va).length > 0) {
          variantDrafts.push({
            entityType: "variant",
            entityId: Number(existingVariant.id),
            changeType: "update",
            beforeData: vb,
            afterData: va
          });
          changedVariantFields.push({ variantId: Number(existingVariant.id), fields: Object.keys(va) });
        }
      }
    }
  }

  const hasProductChange = Object.keys(productAfter).length > 0;
  const hasVariantChange = variantDrafts.length > 0;

  if (!hasProductChange && !hasVariantChange) {
    return NextResponse.json({
      success: true,
      noChange: true,
      message: "No changes detected — the values you submitted already match the current product and variants."
    });
  }

  try {
    let firstDraftId: number | undefined;

    if (hasProductChange) {
      const created = await createDraftChange({
        entityType: "product",
        entityId: Number(id),
        changeType: "update",
        beforeData: productBefore,
        afterData: productAfter
      });
      firstDraftId = Number(created.id);
    }
    if (hasVariantChange) {
      await createDraftChanges(variantDrafts);
    }

    return NextResponse.json({
      success: true,
      item: { id: Number(id), ...parsed.data },
      draftCreated: true,
      draftId: firstDraftId,
      changedFields: productChangedFields,
      changedVariants: changedVariantFields
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
