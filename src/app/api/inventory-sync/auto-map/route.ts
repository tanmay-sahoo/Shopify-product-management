import { NextRequest, NextResponse } from "next/server";

import { getActiveStoreIdOrThrow } from "@/lib/drafts";
import { suggestBySku, suggestByTag, suggestByTitle } from "@/lib/inventory-sync/auto-map";

export async function GET(request: NextRequest) {
  try {
    const storeId = await getActiveStoreIdOrThrow();
    const url = request.nextUrl;
    const strategy = url.searchParams.get("by") ?? "sku";
    let suggestions;
    if (strategy === "tag") suggestions = await suggestByTag(storeId);
    else if (strategy === "title") suggestions = await suggestByTitle(storeId);
    else suggestions = await suggestBySku(storeId);
    return NextResponse.json({ ok: true, strategy, suggestions });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
