import { NextResponse } from "next/server";
import { syncStoreCatalog } from "@/lib/shopify-sync";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storeId = Number(id);

  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ error: "Invalid store id" }, { status: 400 });
  }

  try {
    const result = await syncStoreCatalog(storeId);
    return NextResponse.json({
      success: true,
      queued: false,
      storeId,
      jobType: "shopify.initialSync",
      ...result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json(
      {
        success: false,
        storeId,
        error: message
      },
      { status: 500 }
    );
  }
}
