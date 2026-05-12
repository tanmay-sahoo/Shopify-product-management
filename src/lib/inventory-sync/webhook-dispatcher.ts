import { getPrismaClient } from "@/lib/prisma";

import { isOurOwnEcho, markOrderProcessed, wasOrderProcessed } from "./loop-guard";
import {
  findActiveItemsByInventoryItemGid,
  findActiveItemsByVariantGid,
  getGroup,
  resolveVariantIdByInventoryItemId,
  updateGroup,
  updateGroupItem
} from "./repo";
import {
  deductBundleComponents,
  restockBundleComponents,
  syncBundleGroup,
  syncMirrorGroup,
  syncSharedPoolGroup
} from "./sync";

function inventoryItemGid(raw: number | string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.startsWith("gid://")) return raw;
  return `gid://shopify/InventoryItem/${raw}`;
}

function variantGid(raw: number | string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.startsWith("gid://")) return raw;
  return `gid://shopify/ProductVariant/${raw}`;
}

function locationGid(raw: number | string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.startsWith("gid://")) return raw;
  return `gid://shopify/Location/${raw}`;
}

async function logEvent(storeId: number, jobType: string, ok: boolean, message: string) {
  await getPrismaClient().syncLog.create({
    data: {
      storeId: BigInt(storeId),
      jobType,
      status: ok ? "success" : "failed",
      message: message.slice(0, 500),
      startedAt: new Date(),
      completedAt: new Date()
    }
  });
}

export async function handleInventoryLevelUpdate(
  storeId: number,
  payload: { inventory_item_id?: number | string; location_id?: number | string; available?: number }
): Promise<{ matched: number; outcomes: string[] }> {
  const invGid = inventoryItemGid(payload.inventory_item_id);
  const locGid = locationGid(payload.location_id);
  if (!invGid || typeof payload.available !== "number") return { matched: 0, outcomes: [] };

  if (locGid && isOurOwnEcho(storeId, invGid, locGid, payload.available)) {
    return { matched: 0, outcomes: ["echo-skipped"] };
  }

  let items = await findActiveItemsByInventoryItemGid(storeId, invGid);
  if (items.length === 0) {
    const variantGidFromVariantTable = await resolveVariantIdByInventoryItemId(storeId, invGid);
    if (variantGidFromVariantTable) {
      items = await findActiveItemsByVariantGid(storeId, variantGidFromVariantTable);
      for (const it of items) {
        if (!it.inventoryItemId) {
          await updateGroupItem(it.id, { inventoryItemId: invGid });
        }
      }
    }
  }
  if (items.length === 0) return { matched: 0, outcomes: [] };

  const outcomes: string[] = [];
  const visitedGroups = new Set<number>();
  for (const item of items) {
    if (visitedGroups.has(item.groupId)) continue;
    visitedGroups.add(item.groupId);
    const group = await getGroup(item.groupId);
    if (!group || !group.active) continue;

    try {
      if (group.mode === "mirror" && item.role === "source") {
        const r = await syncMirrorGroup(group, { trigger: "webhook-inventory" });
        outcomes.push(`mirror#${group.id}:${r.message}`);
        await updateGroup(group.id, { lastSyncedAt: r.ok ? new Date() : null, lastError: r.ok ? null : r.message });
      } else if (group.mode === "shared_pool") {
        const r = await syncSharedPoolGroup(group, { trigger: "webhook-inventory" });
        outcomes.push(`pool#${group.id}:${r.message}`);
        await updateGroup(group.id, { lastSyncedAt: r.ok ? new Date() : null, lastError: r.ok ? null : r.message });
      } else if (group.mode === "bundle" && item.role === "component") {
        const r = await syncBundleGroup(group, { trigger: "webhook-component-changed" });
        outcomes.push(`bundle#${group.id}:${r.message}`);
        await updateGroup(group.id, { lastSyncedAt: r.ok ? new Date() : null, lastError: r.ok ? null : r.message });
      }
    } catch (error) {
      outcomes.push(`error#${group.id}:${error instanceof Error ? error.message : "unknown"}`);
    }
  }
  await logEvent(storeId, "webhook.inventory_levels/update", true, outcomes.join(" | ") || "no matching groups");
  return { matched: items.length, outcomes };
}

export async function handleProductUpdate(
  storeId: number,
  payload: { id?: number; variants?: Array<{ id?: number; price?: string }> }
): Promise<{ matched: number; outcomes: string[] }> {
  if (!Array.isArray(payload.variants)) return { matched: 0, outcomes: [] };
  const outcomes: string[] = [];
  let matched = 0;
  const visitedGroups = new Set<number>();
  for (const v of payload.variants) {
    const vGid = variantGid(v.id);
    if (!vGid) continue;
    const items = await findActiveItemsByVariantGid(storeId, vGid);
    for (const item of items) {
      if (visitedGroups.has(item.groupId)) continue;
      visitedGroups.add(item.groupId);
      const group = await getGroup(item.groupId);
      if (!group || !group.active || !group.syncPrice) continue;
      try {
        if (group.mode === "mirror" && item.role === "source") {
          const r = await syncMirrorGroup(group, { trigger: "webhook-price" });
          outcomes.push(`mirror#${group.id}:${r.message}`);
          matched++;
        } else if (group.mode === "shared_pool" && item.id === group.items[0]?.id) {
          const r = await syncSharedPoolGroup(group, { trigger: "webhook-price" });
          outcomes.push(`pool#${group.id}:${r.message}`);
          matched++;
        }
      } catch (error) {
        outcomes.push(`error#${group.id}:${error instanceof Error ? error.message : "unknown"}`);
      }
    }
  }
  if (matched > 0) await logEvent(storeId, "webhook.products/update.price", true, outcomes.join(" | "));
  return { matched, outcomes };
}

type OrderPayload = {
  id?: number;
  line_items?: Array<{ variant_id?: number; quantity?: number }>;
  refunds?: Array<{ refund_line_items?: Array<{ line_item?: { variant_id?: number }; quantity?: number; restock_type?: string }> }>;
};

export async function handleOrderCreate(storeId: number, payload: OrderPayload): Promise<{ outcomes: string[] }> {
  if (!payload.id || !Array.isArray(payload.line_items)) return { outcomes: [] };
  const orderKey = String(payload.id);
  if (wasOrderProcessed(storeId, orderKey, "orders/create")) return { outcomes: ["already-processed"] };
  markOrderProcessed(storeId, orderKey, "orders/create");

  const outcomes: string[] = [];
  const visited = new Set<number>();
  for (const line of payload.line_items) {
    const vGid = variantGid(line.variant_id);
    const qty = line.quantity ?? 0;
    if (!vGid || qty <= 0) continue;
    const items = await findActiveItemsByVariantGid(storeId, vGid);
    for (const item of items) {
      if (visited.has(item.groupId)) continue;
      visited.add(item.groupId);
      const group = await getGroup(item.groupId);
      if (!group || !group.active) continue;
      try {
        if (group.mode === "shared_pool") {
          const r = await syncSharedPoolGroup(group, { trigger: "webhook-order-pool" });
          outcomes.push(`pool#${group.id}:${r.message}`);
        } else if (group.mode === "bundle" && item.role === "combo") {
          const r = await deductBundleComponents(group, vGid, qty, "webhook-order-bundle");
          outcomes.push(`bundle#${group.id}:${r.message}`);
        }
      } catch (error) {
        outcomes.push(`error#${group.id}:${error instanceof Error ? error.message : "unknown"}`);
      }
    }
  }
  await logEvent(storeId, "webhook.orders/create", true, outcomes.join(" | ") || "no group impact");
  return { outcomes };
}

export async function handleOrderCancelled(storeId: number, payload: OrderPayload): Promise<{ outcomes: string[] }> {
  if (!payload.id || !Array.isArray(payload.line_items)) return { outcomes: [] };
  const orderKey = String(payload.id);
  if (wasOrderProcessed(storeId, orderKey, "orders/cancelled")) return { outcomes: ["already-processed"] };
  markOrderProcessed(storeId, orderKey, "orders/cancelled");

  const outcomes: string[] = [];
  const visited = new Set<number>();
  for (const line of payload.line_items) {
    const vGid = variantGid(line.variant_id);
    const qty = line.quantity ?? 0;
    if (!vGid || qty <= 0) continue;
    const items = await findActiveItemsByVariantGid(storeId, vGid);
    for (const item of items) {
      if (visited.has(item.groupId)) continue;
      visited.add(item.groupId);
      const group = await getGroup(item.groupId);
      if (!group || !group.active) continue;
      try {
        if (group.mode === "shared_pool") {
          // Re-sync: each member's available will reflect new stock from cancel
          const r = await syncSharedPoolGroup(group, { trigger: "webhook-cancel-pool" });
          outcomes.push(`pool#${group.id}:${r.message}`);
        } else if (group.mode === "bundle" && item.role === "combo") {
          const r = await restockBundleComponents(group, vGid, qty, "webhook-cancel-bundle");
          outcomes.push(`bundle#${group.id}:${r.message}`);
        }
      } catch (error) {
        outcomes.push(`error#${group.id}:${error instanceof Error ? error.message : "unknown"}`);
      }
    }
  }
  await logEvent(storeId, "webhook.orders/cancelled", true, outcomes.join(" | ") || "no group impact");
  return { outcomes };
}

type RefundPayload = {
  id?: number;
  order_id?: number;
  refund_line_items?: Array<{ line_item?: { variant_id?: number }; quantity?: number; restock_type?: string }>;
};

export async function handleRefundCreate(storeId: number, payload: RefundPayload): Promise<{ outcomes: string[] }> {
  if (!payload.id) return { outcomes: [] };
  const orderKey = `${payload.order_id ?? "?"}#refund#${payload.id}`;
  if (wasOrderProcessed(storeId, orderKey, "refunds/create")) return { outcomes: ["already-processed"] };
  markOrderProcessed(storeId, orderKey, "refunds/create");

  const lines = payload.refund_line_items ?? [];
  const outcomes: string[] = [];
  const visited = new Set<number>();
  for (const line of lines) {
    const restocked =
      line.restock_type === "return" || line.restock_type === "cancel" || line.restock_type === "legacy_restock";
    if (!restocked) continue;
    const vGid = variantGid(line.line_item?.variant_id);
    const qty = line.quantity ?? 0;
    if (!vGid || qty <= 0) continue;
    const items = await findActiveItemsByVariantGid(storeId, vGid);
    for (const item of items) {
      if (visited.has(item.groupId)) continue;
      visited.add(item.groupId);
      const group = await getGroup(item.groupId);
      if (!group || !group.active) continue;
      try {
        if (group.mode === "shared_pool") {
          const r = await syncSharedPoolGroup(group, { trigger: "webhook-refund-pool" });
          outcomes.push(`pool#${group.id}:${r.message}`);
        } else if (group.mode === "bundle" && item.role === "combo") {
          const r = await restockBundleComponents(group, vGid, qty, "webhook-refund-bundle");
          outcomes.push(`bundle#${group.id}:${r.message}`);
        }
      } catch (error) {
        outcomes.push(`error#${group.id}:${error instanceof Error ? error.message : "unknown"}`);
      }
    }
  }
  await logEvent(storeId, "webhook.refunds/create", true, outcomes.join(" | ") || "no group impact");
  return { outcomes };
}

