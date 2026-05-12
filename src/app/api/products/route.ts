import { NextRequest, NextResponse } from "next/server";

import { createDraftChange } from "@/lib/drafts";
import { products } from "@/lib/mock-data";
import { productPatchSchema } from "@/lib/validation";

export async function GET() {
  return NextResponse.json({ items: products });
}

export async function POST(request: NextRequest) {
  const payload = await request.json();
  const parsed = productPatchSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!parsed.data.title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  try {
    const draft = await createDraftChange({
      entityType: "product",
      changeType: "create",
      afterData: parsed.data
    });
    return NextResponse.json({
      success: true,
      item: { id: Number(draft.id), ...parsed.data },
      draftCreated: true,
      draftId: Number(draft.id)
    });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_ACTIVE_STORE") {
      return NextResponse.json(
        { error: "Connect a Shopify store before creating products." },
        { status: 400 }
      );
    }
    console.error("[POST /api/products] draft create failed:", error);
    return NextResponse.json({ error: "Failed to stage product." }, { status: 500 });
  }
}
