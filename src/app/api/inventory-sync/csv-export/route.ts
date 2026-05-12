import { NextRequest, NextResponse } from "next/server";

import { getActiveStoreIdOrThrow } from "@/lib/drafts";
import { exportGroupsCsv } from "@/lib/inventory-sync/csv";
import { listGroups } from "@/lib/inventory-sync/repo";

export async function GET(request: NextRequest) {
  try {
    const storeId = await getActiveStoreIdOrThrow();
    const url = request.nextUrl;
    const requested = url.searchParams.get("mode");
    const groups = await listGroups(storeId);
    const csv = exportGroupsCsv(groups);
    if (requested === "mirror" || requested === "shared_pool" || requested === "bundle") {
      return new NextResponse(csv[requested], {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="inventory-sync-${requested}.csv"`
        }
      });
    }
    return NextResponse.json({ ok: true, csv });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
