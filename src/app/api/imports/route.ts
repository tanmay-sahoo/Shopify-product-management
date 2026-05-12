import { NextRequest, NextResponse } from "next/server";

import { createDraftChanges, type DraftInput } from "@/lib/drafts";
import { importSummary } from "@/lib/mock-data";

type IncomingRow = {
  handle?: string;
  sku?: string;
  title?: string;
  price?: string;
  inventory?: string;
  imageColumns?: string[];
  actionType?: "create_product" | "update_product" | "create_variant" | "update_variant" | "skip";
};

export async function GET() {
  return NextResponse.json({ items: [importSummary] });
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => ({}));
  const rows: IncomingRow[] = Array.isArray(payload?.rows) ? payload.rows : [];

  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows to stage" }, { status: 400 });
  }

  const inputs: DraftInput[] = rows
    .filter((row) => row.actionType !== "skip")
    .map((row) => {
      const action = row.actionType ?? "update_variant";
      const isVariant = action.includes("variant");
      const isCreate = action.startsWith("create");
      return {
        entityType: isVariant ? ("variant" as const) : ("product" as const),
        changeType: isCreate ? ("create" as const) : ("update" as const),
        afterData: row
      };
    });

  if (inputs.length === 0) {
    return NextResponse.json({ error: "All rows were marked as skip" }, { status: 400 });
  }

  try {
    const result = await createDraftChanges(inputs);
    return NextResponse.json({
      success: true,
      fileName: typeof payload?.fileName === "string" ? payload.fileName : "upload.csv",
      queued: result.count,
      draftCreated: true
    });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_ACTIVE_STORE") {
      return NextResponse.json(
        { error: "Connect a Shopify store before importing rows." },
        { status: 400 }
      );
    }
    console.error("[POST /api/imports] draft create failed:", error);
    return NextResponse.json({ error: "Failed to stage import rows." }, { status: 500 });
  }
}
