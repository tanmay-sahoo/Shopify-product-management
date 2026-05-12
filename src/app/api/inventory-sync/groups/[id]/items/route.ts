import { NextRequest, NextResponse } from "next/server";

import { getActiveStoreIdOrThrow } from "@/lib/drafts";
import {
  backfillInventoryItemIdForVariant,
  createGroupItem,
  deleteGroupItem,
  updateGroupItem
} from "@/lib/inventory-sync/repo";
import { loadStoreCreds, lookupVariant } from "@/lib/inventory-sync/shopify-api";
import type { ItemRole } from "@/lib/inventory-sync/types";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const groupId = Number(id);
  if (!Number.isFinite(groupId)) return NextResponse.json({ ok: false, error: "invalid group id" }, { status: 400 });
  const storeId = await getActiveStoreIdOrThrow();
  const body = (await request.json()) as {
    shopifyVariantId: string;
    shopifyProductId?: string | null;
    inventoryItemId?: string | null;
    locationId?: string | null;
    role: ItemRole;
    quantityRequired?: number;
    stockBuffer?: number;
    priceMultiplier?: number;
    syncStock?: boolean;
    syncPrice?: boolean;
  };
  if (!body.shopifyVariantId || !body.role) {
    return NextResponse.json({ ok: false, error: "shopifyVariantId and role are required" }, { status: 400 });
  }
  let invId = body.inventoryItemId ?? null;
  if (!invId) {
    invId = await backfillInventoryItemIdForVariant(storeId, body.shopifyVariantId);
  }
  if (!invId) {
    const creds = await loadStoreCreds(storeId);
    if (creds) {
      const fresh = await lookupVariant(creds, body.shopifyVariantId);
      invId = fresh?.inventoryItemId ?? null;
    }
  }
  const itemId = await createGroupItem({
    groupId,
    storeId,
    productId: null,
    variantId: null,
    shopifyProductId: body.shopifyProductId ?? null,
    shopifyVariantId: body.shopifyVariantId,
    inventoryItemId: invId,
    locationId: body.locationId ?? null,
    role: body.role,
    quantityRequired: body.quantityRequired,
    stockBuffer: body.stockBuffer,
    priceMultiplier: body.priceMultiplier,
    syncStock: body.syncStock,
    syncPrice: body.syncPrice
  });
  return NextResponse.json({ ok: true, itemId });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as { itemId: number } & Record<string, unknown>;
  const { itemId, ...rest } = body;
  if (!itemId) return NextResponse.json({ ok: false, error: "itemId required" }, { status: 400 });
  await updateGroupItem(Number(itemId), rest as Parameters<typeof updateGroupItem>[1]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json()) as { itemId?: number };
  if (!body.itemId) return NextResponse.json({ ok: false, error: "itemId required" }, { status: 400 });
  await deleteGroupItem(Number(body.itemId));
  return NextResponse.json({ ok: true });
}
