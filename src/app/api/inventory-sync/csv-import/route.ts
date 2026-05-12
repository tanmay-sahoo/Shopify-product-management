import { NextRequest, NextResponse } from "next/server";

import { getActiveStoreIdOrThrow } from "@/lib/drafts";
import { parseCsvForMode, type GroupDraft } from "@/lib/inventory-sync/csv";
import { createGroup, createGroupItem } from "@/lib/inventory-sync/repo";
import type { SyncMode } from "@/lib/inventory-sync/types";

type Body = { mode: SyncMode; csv: string; dryRun?: boolean };

export async function POST(request: NextRequest) {
  try {
    const storeId = await getActiveStoreIdOrThrow();
    const body = (await request.json()) as Body;
    if (!body.mode || !body.csv) {
      return NextResponse.json({ ok: false, error: "mode and csv are required" }, { status: 400 });
    }
    const parsed = parseCsvForMode(body.mode, body.csv);
    if (parsed.errors.length > 0 || body.dryRun) {
      return NextResponse.json({ ok: parsed.errors.length === 0, dryRun: !!body.dryRun, parsed });
    }
    const created: Array<{ groupId: number; name: string }> = [];
    for (const draft of parsed.groups) {
      const groupId = await persistDraft(storeId, draft);
      created.push({ groupId, name: draft.name });
    }
    return NextResponse.json({ ok: true, created });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

async function persistDraft(storeId: number, draft: GroupDraft): Promise<number> {
  const groupId = await createGroup(storeId, {
    name: draft.name,
    mode: draft.mode,
    syncStock: draft.syncStock,
    syncPrice: draft.syncPrice,
    active: true
  });
  for (const item of draft.items) {
    await createGroupItem({
      groupId,
      storeId,
      productId: null,
      variantId: null,
      shopifyProductId: null,
      shopifyVariantId: item.shopifyVariantId,
      inventoryItemId: null,
      locationId: null,
      role: item.role,
      quantityRequired: item.quantityRequired,
      stockBuffer: item.stockBuffer,
      priceMultiplier: item.priceMultiplier,
      syncStock: item.syncStock,
      syncPrice: item.syncPrice
    });
  }
  return groupId;
}
