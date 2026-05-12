import { NextRequest, NextResponse } from "next/server";

import { createDraftChanges, type DraftInput } from "@/lib/drafts";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => ({}));
  const ids = Array.isArray(payload?.ids)
    ? payload.ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isFinite(id))
    : [];
  const action = payload?.action ?? null;

  if (ids.length === 0) {
    return NextResponse.json({ error: "No products selected" }, { status: 400 });
  }
  if (!action || typeof action !== "object") {
    return NextResponse.json({ error: "No action specified" }, { status: 400 });
  }

  const changeType: DraftInput["changeType"] = action.type === "delete" ? "delete" : "update";

  const inputs: DraftInput[] = ids.map((id: number) => ({
    entityType: "product",
    entityId: id,
    changeType,
    afterData: { action }
  }));

  try {
    const result = await createDraftChanges(inputs);
    return NextResponse.json({
      success: true,
      queued: true,
      selectionCount: result.count
    });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_ACTIVE_STORE") {
      return NextResponse.json(
        { error: "Connect a Shopify store before staging bulk changes." },
        { status: 400 }
      );
    }
    console.error("[POST /api/products/bulk-update] draft create failed:", error);
    return NextResponse.json({ error: "Failed to stage bulk action." }, { status: 500 });
  }
}
