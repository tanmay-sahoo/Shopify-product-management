import { NextRequest, NextResponse } from "next/server";

import { getActiveStoreIdOrThrow } from "@/lib/drafts";
import { backfillInventoryItemIdForVariant, createGroup, createGroupItem, listGroups } from "@/lib/inventory-sync/repo";
import { loadStoreCreds, lookupVariant } from "@/lib/inventory-sync/shopify-api";
import type { SyncMode } from "@/lib/inventory-sync/types";

export async function GET(request: NextRequest) {
  try {
    const storeId = await getActiveStoreIdOrThrow();
    const url = request.nextUrl;
    const mode = (url.searchParams.get("mode") as SyncMode | null) ?? undefined;
    const activeParam = url.searchParams.get("active");
    const active = activeParam === null ? undefined : activeParam === "true";
    const search = url.searchParams.get("search") ?? undefined;
    const groups = await listGroups(storeId, { mode, active, search });
    return NextResponse.json({ ok: true, groups });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

type CreatePayload = {
  name?: string;
  mode?: SyncMode;
  syncStock?: boolean;
  syncPrice?: boolean;
  active?: boolean;
  items?: Array<{
    shopifyVariantId: string;
    shopifyProductId?: string | null;
    role: "source" | "target" | "component" | "combo" | "member";
    quantityRequired?: number;
    stockBuffer?: number;
    priceMultiplier?: number;
    syncStock?: boolean;
    syncPrice?: boolean;
    inventoryItemId?: string | null;
    locationId?: string | null;
  }>;
};

export async function POST(request: NextRequest) {
  try {
    const storeId = await getActiveStoreIdOrThrow();
    const body = (await request.json()) as CreatePayload;

    if (!body.name || !body.mode) {
      return NextResponse.json({ ok: false, error: "name and mode are required" }, { status: 400 });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ ok: false, error: "at least one item is required" }, { status: 400 });
    }

    if (body.mode === "mirror") {
      const sources = body.items.filter((it) => it.role === "source");
      if (sources.length !== 1) {
        return NextResponse.json({ ok: false, error: "mirror mode requires exactly one source" }, { status: 400 });
      }
      const sourceGid = sources[0].shopifyVariantId;
      if (body.items.some((it) => it.role === "target" && it.shopifyVariantId === sourceGid)) {
        return NextResponse.json({ ok: false, error: "source and target cannot be the same variant" }, { status: 400 });
      }
    }
    if (body.mode === "bundle") {
      const combos = body.items.filter((it) => it.role === "combo");
      const components = body.items.filter((it) => it.role === "component");
      if (combos.length === 0 || components.length === 0) {
        return NextResponse.json({ ok: false, error: "bundle requires at least one combo and one component" }, { status: 400 });
      }
      const comboGids = new Set(combos.map((c) => c.shopifyVariantId));
      if (components.some((c) => comboGids.has(c.shopifyVariantId))) {
        return NextResponse.json({ ok: false, error: "a variant cannot be both combo and component" }, { status: 400 });
      }
    }

    const groupId = await createGroup(storeId, {
      name: body.name,
      mode: body.mode,
      syncStock: body.syncStock ?? true,
      syncPrice: body.syncPrice ?? false,
      active: body.active ?? true
    });

    const creds = await loadStoreCreds(storeId);
    for (const item of body.items) {
      let invId = item.inventoryItemId ?? null;
      if (!invId) {
        invId = await backfillInventoryItemIdForVariant(storeId, item.shopifyVariantId);
      }
      if (!invId && creds) {
        const fresh = await lookupVariant(creds, item.shopifyVariantId);
        invId = fresh?.inventoryItemId ?? null;
      }
      await createGroupItem({
        groupId,
        storeId,
        productId: null,
        variantId: null,
        shopifyProductId: item.shopifyProductId ?? null,
        shopifyVariantId: item.shopifyVariantId,
        inventoryItemId: invId,
        locationId: item.locationId ?? null,
        role: item.role,
        quantityRequired: item.quantityRequired ?? 1,
        stockBuffer: item.stockBuffer ?? 0,
        priceMultiplier: item.priceMultiplier ?? 1,
        syncStock: item.syncStock,
        syncPrice: item.syncPrice
      });
    }

    return NextResponse.json({ ok: true, groupId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "NO_ACTIVE_STORE" ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
