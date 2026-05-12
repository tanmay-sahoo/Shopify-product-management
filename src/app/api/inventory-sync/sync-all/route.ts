import { NextRequest, NextResponse } from "next/server";

import { getActiveStoreIdOrThrow } from "@/lib/drafts";
import { listGroups } from "@/lib/inventory-sync/repo";
import { syncGroup } from "@/lib/inventory-sync/sync";

export async function POST(request: NextRequest) {
  try {
    const storeId = await getActiveStoreIdOrThrow();
    const url = request.nextUrl;
    const dryRun = url.searchParams.get("dryRun") === "true";
    const groups = await listGroups(storeId, { active: true });
    const results = [];
    for (const g of groups) {
      const outcome = await syncGroup(g.id, { dryRun, trigger: dryRun ? "dry-run-all" : "manual-all" });
      results.push({ groupId: g.id, name: g.name, ...outcome });
    }
    return NextResponse.json({ ok: true, dryRun, results });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
