import { getPrismaClient } from "@/lib/prisma";

import {
  bulkUpdateVariantPrices,
  getInventoryAvailableAtLocation,
  getPrimaryLocation,
  loadStoreCreds,
  lookupVariant,
  setInventoryQuantity,
  type StoreCreds,
  type VariantInfo
} from "./shopify-api";
import { markWrite } from "./loop-guard";
import { getGroup, updateGroup } from "./repo";
import type { SyncGroupItem, SyncGroupWithItems, SyncOutcome } from "./types";

type SyncOptions = { dryRun?: boolean; trigger?: string };

function emptyOutcome(message: string, dryRun?: boolean): SyncOutcome {
  return { ok: true, message, dryRun, changes: [] };
}

async function fetchVariantSnapshots(
  store: StoreCreds,
  items: SyncGroupItem[],
  locationId: string
): Promise<Map<string, { info: VariantInfo; available: number | null }>> {
  const out = new Map<string, { info: VariantInfo; available: number | null }>();
  await Promise.all(
    items.map(async (item) => {
      const info = await lookupVariant(store, item.shopifyVariantId);
      if (!info) return;
      const invId = info.inventoryItemId ?? item.inventoryItemId;
      const available = invId ? await getInventoryAvailableAtLocation(store, invId, locationId) : null;
      out.set(item.shopifyVariantId, { info, available });
    })
  );
  return out;
}

async function applyStock(
  store: StoreCreds,
  inventoryItemId: string,
  locationId: string,
  quantity: number,
  trigger: string
) {
  const result = await setInventoryQuantity(store, {
    inventoryItemId,
    locationId,
    quantity,
    referenceDocumentUri: `app://linked-inventory-sync/${trigger}`
  });
  if (result.ok) markWrite(store.id, inventoryItemId, locationId, quantity);
  return result;
}

export async function syncMirrorGroup(group: SyncGroupWithItems, opts: SyncOptions = {}): Promise<SyncOutcome> {
  const store = await loadStoreCreds(group.storeId);
  if (!store) return { ok: false, message: "Store not connected", changes: [] };

  const locationId = await getPrimaryLocation(store);
  if (!locationId) return { ok: false, message: "No Shopify location available", changes: [] };

  const source = group.items.find((item) => item.role === "source" && item.active);
  const targets = group.items.filter((item) => item.role === "target" && item.active);
  if (!source) return { ok: false, message: "Mirror group has no source", changes: [] };
  if (targets.length === 0) return emptyOutcome("Mirror group has no targets", opts.dryRun);

  const snapshots = await fetchVariantSnapshots(store, [source, ...targets], locationId);
  const sourceSnap = snapshots.get(source.shopifyVariantId);
  if (!sourceSnap?.info) return { ok: false, message: "Could not load source variant from Shopify", changes: [] };

  const sourceStock = sourceSnap.available ?? sourceSnap.info.inventoryQuantity ?? 0;
  const sourcePriceStr = sourceSnap.info.price;

  const changes: SyncOutcome["changes"] = [];
  const priceUpdatesByProduct = new Map<string, Array<{ id: string; price: string }>>();

  for (const target of targets) {
    const snap = snapshots.get(target.shopifyVariantId);
    if (!snap?.info) continue;
    const invId = snap.info.inventoryItemId ?? target.inventoryItemId;

    if (group.syncStock && target.syncStock && invId) {
      const desired = Math.max(0, sourceStock - target.stockBuffer);
      const current = snap.available ?? snap.info.inventoryQuantity ?? 0;
      if (current !== desired) {
        if (!opts.dryRun) {
          const r = await applyStock(store, invId, locationId, desired, opts.trigger ?? "manual-mirror");
          if (!r.ok) return { ok: false, message: `Failed on target ${target.shopifyVariantId}: ${r.message}`, changes };
        }
        changes.push({
          variantId: target.shopifyVariantId,
          inventoryItemId: invId,
          field: "stock",
          from: current,
          to: desired,
          applied: !opts.dryRun
        });
      }
    }

    if (group.syncPrice && target.syncPrice && sourcePriceStr !== null) {
      const desiredPrice = (Number(sourcePriceStr) * target.priceMultiplier).toFixed(2);
      if (snap.info.price !== desiredPrice) {
        const list = priceUpdatesByProduct.get(snap.info.productId) ?? [];
        list.push({ id: target.shopifyVariantId, price: desiredPrice });
        priceUpdatesByProduct.set(snap.info.productId, list);
        changes.push({
          variantId: target.shopifyVariantId,
          field: "price",
          from: snap.info.price !== null ? Number(snap.info.price) : null,
          to: Number(desiredPrice),
          applied: !opts.dryRun
        });
      }
    }
  }

  if (!opts.dryRun) {
    for (const [productId, updates] of priceUpdatesByProduct) {
      const r = await bulkUpdateVariantPrices(store, productId, updates);
      if (!r.ok) return { ok: false, message: `Price bulk update failed: ${r.message}`, changes };
    }
  }

  return { ok: true, message: `Synced ${changes.length} change(s)`, dryRun: opts.dryRun, changes };
}

export async function syncSharedPoolGroup(group: SyncGroupWithItems, opts: SyncOptions = {}): Promise<SyncOutcome> {
  const store = await loadStoreCreds(group.storeId);
  if (!store) return { ok: false, message: "Store not connected", changes: [] };

  const locationId = await getPrimaryLocation(store);
  if (!locationId) return { ok: false, message: "No Shopify location available", changes: [] };

  const members = group.items.filter((item) => item.active);
  if (members.length < 2) return emptyOutcome("Shared pool needs at least 2 members", opts.dryRun);

  const snapshots = await fetchVariantSnapshots(store, members, locationId);

  // Pool quantity = the minimum observed available, treating all members as one stock.
  // If a recent webhook fired with a specific value, the dispatcher passes the new value
  // via opts (we keep this generic and just trust observed state on manual sync).
  let pool = Number.POSITIVE_INFINITY;
  for (const m of members) {
    const snap = snapshots.get(m.shopifyVariantId);
    const v = snap?.available ?? snap?.info.inventoryQuantity ?? null;
    if (v === null) continue;
    if (v < pool) pool = v;
  }
  if (!Number.isFinite(pool)) return emptyOutcome("Could not determine pool stock", opts.dryRun);

  const changes: SyncOutcome["changes"] = [];
  const priceLeader = members[0];
  const leaderSnap = snapshots.get(priceLeader.shopifyVariantId);
  const leaderPrice = leaderSnap?.info.price ?? null;
  const priceUpdatesByProduct = new Map<string, Array<{ id: string; price: string }>>();

  for (const m of members) {
    const snap = snapshots.get(m.shopifyVariantId);
    if (!snap?.info) continue;
    const invId = snap.info.inventoryItemId ?? m.inventoryItemId;
    if (group.syncStock && m.syncStock && invId) {
      const current = snap.available ?? snap.info.inventoryQuantity ?? 0;
      if (current !== pool) {
        if (!opts.dryRun) {
          const r = await applyStock(store, invId, locationId, pool, opts.trigger ?? "manual-pool");
          if (!r.ok) return { ok: false, message: `Failed on member ${m.shopifyVariantId}: ${r.message}`, changes };
        }
        changes.push({
          variantId: m.shopifyVariantId,
          inventoryItemId: invId,
          field: "stock",
          from: current,
          to: pool,
          applied: !opts.dryRun
        });
      }
    }

    if (group.syncPrice && m.syncPrice && leaderPrice !== null && m.id !== priceLeader.id) {
      const desired = (Number(leaderPrice) * m.priceMultiplier).toFixed(2);
      if (snap.info.price !== desired) {
        const list = priceUpdatesByProduct.get(snap.info.productId) ?? [];
        list.push({ id: m.shopifyVariantId, price: desired });
        priceUpdatesByProduct.set(snap.info.productId, list);
        changes.push({
          variantId: m.shopifyVariantId,
          field: "price",
          from: snap.info.price !== null ? Number(snap.info.price) : null,
          to: Number(desired),
          applied: !opts.dryRun
        });
      }
    }
  }

  if (!opts.dryRun) {
    for (const [productId, updates] of priceUpdatesByProduct) {
      const r = await bulkUpdateVariantPrices(store, productId, updates);
      if (!r.ok) return { ok: false, message: `Price bulk update failed: ${r.message}`, changes };
    }
  }

  return { ok: true, message: `Synced pool to ${pool} (${changes.length} change(s))`, dryRun: opts.dryRun, changes };
}

export async function calculateBundleStock(group: SyncGroupWithItems, store: StoreCreds, locationId: string): Promise<number> {
  const components = group.items.filter((item) => item.role === "component" && item.active);
  if (components.length === 0) return 0;
  let combo = Number.POSITIVE_INFINITY;
  for (const c of components) {
    const info = await lookupVariant(store, c.shopifyVariantId);
    const invId = info?.inventoryItemId ?? c.inventoryItemId;
    const available = invId ? await getInventoryAvailableAtLocation(store, invId, locationId) : null;
    const stock = available ?? info?.inventoryQuantity ?? 0;
    const qty = Math.max(1, c.quantityRequired);
    const possible = Math.floor(stock / qty);
    if (possible < combo) combo = possible;
  }
  return Number.isFinite(combo) ? Math.max(0, combo) : 0;
}

export async function syncBundleGroup(group: SyncGroupWithItems, opts: SyncOptions = {}): Promise<SyncOutcome> {
  const store = await loadStoreCreds(group.storeId);
  if (!store) return { ok: false, message: "Store not connected", changes: [] };

  const locationId = await getPrimaryLocation(store);
  if (!locationId) return { ok: false, message: "No Shopify location available", changes: [] };

  const combos = group.items.filter((item) => item.role === "combo" && item.active);
  if (combos.length === 0) return emptyOutcome("Bundle group has no combo variant", opts.dryRun);

  const newStock = await calculateBundleStock(group, store, locationId);

  const changes: SyncOutcome["changes"] = [];
  for (const combo of combos) {
    const info = await lookupVariant(store, combo.shopifyVariantId);
    const invId = info?.inventoryItemId ?? combo.inventoryItemId;
    if (!invId) continue;
    const current = (invId ? await getInventoryAvailableAtLocation(store, invId, locationId) : null)
      ?? info?.inventoryQuantity
      ?? 0;
    if (current !== newStock) {
      if (!opts.dryRun) {
        const r = await applyStock(store, invId, locationId, newStock, opts.trigger ?? "manual-bundle");
        if (!r.ok) return { ok: false, message: `Failed on combo ${combo.shopifyVariantId}: ${r.message}`, changes };
      }
      changes.push({
        variantId: combo.shopifyVariantId,
        inventoryItemId: invId,
        field: "stock",
        from: current,
        to: newStock,
        applied: !opts.dryRun
      });
    }
  }
  return { ok: true, message: `Bundle stock = ${newStock} (${changes.length} change(s))`, dryRun: opts.dryRun, changes };
}

export async function deductBundleComponents(
  group: SyncGroupWithItems,
  comboVariantGid: string,
  quantitySold: number,
  trigger: string
): Promise<SyncOutcome> {
  const store = await loadStoreCreds(group.storeId);
  if (!store) return { ok: false, message: "Store not connected", changes: [] };
  const locationId = await getPrimaryLocation(store);
  if (!locationId) return { ok: false, message: "No Shopify location available", changes: [] };

  const matchedCombo = group.items.find((item) => item.role === "combo" && item.shopifyVariantId === comboVariantGid);
  if (!matchedCombo) return emptyOutcome("Combo variant not in group");

  const components = group.items.filter((item) => item.role === "component" && item.active);
  const changes: SyncOutcome["changes"] = [];

  for (const c of components) {
    const info = await lookupVariant(store, c.shopifyVariantId);
    const invId = info?.inventoryItemId ?? c.inventoryItemId;
    if (!invId) continue;
    const current = (await getInventoryAvailableAtLocation(store, invId, locationId)) ?? info?.inventoryQuantity ?? 0;
    const desired = Math.max(0, current - c.quantityRequired * quantitySold);
    if (current === desired) continue;
    const r = await applyStock(store, invId, locationId, desired, trigger);
    if (!r.ok) return { ok: false, message: `Failed deducting component ${c.shopifyVariantId}: ${r.message}`, changes };
    changes.push({ variantId: c.shopifyVariantId, inventoryItemId: invId, field: "stock", from: current, to: desired, applied: true });
  }
  return { ok: true, message: `Deducted ${changes.length} component(s)`, changes };
}

export async function restockBundleComponents(
  group: SyncGroupWithItems,
  comboVariantGid: string,
  quantity: number,
  trigger: string
): Promise<SyncOutcome> {
  const store = await loadStoreCreds(group.storeId);
  if (!store) return { ok: false, message: "Store not connected", changes: [] };
  const locationId = await getPrimaryLocation(store);
  if (!locationId) return { ok: false, message: "No Shopify location available", changes: [] };

  const matchedCombo = group.items.find((item) => item.role === "combo" && item.shopifyVariantId === comboVariantGid);
  if (!matchedCombo) return emptyOutcome("Combo variant not in group");

  const components = group.items.filter((item) => item.role === "component" && item.active);
  const changes: SyncOutcome["changes"] = [];
  for (const c of components) {
    const info = await lookupVariant(store, c.shopifyVariantId);
    const invId = info?.inventoryItemId ?? c.inventoryItemId;
    if (!invId) continue;
    const current = (await getInventoryAvailableAtLocation(store, invId, locationId)) ?? info?.inventoryQuantity ?? 0;
    const desired = current + c.quantityRequired * quantity;
    if (current === desired) continue;
    const r = await applyStock(store, invId, locationId, desired, trigger);
    if (!r.ok) return { ok: false, message: `Failed restocking ${c.shopifyVariantId}: ${r.message}`, changes };
    changes.push({ variantId: c.shopifyVariantId, inventoryItemId: invId, field: "stock", from: current, to: desired, applied: true });
  }
  return { ok: true, message: `Restocked ${changes.length} component(s)`, changes };
}

export async function syncGroup(groupId: number, opts: SyncOptions = {}): Promise<SyncOutcome> {
  const group = await getGroup(groupId);
  if (!group) return { ok: false, message: "Group not found", changes: [] };
  if (!group.active) return emptyOutcome("Group is paused", opts.dryRun);

  let outcome: SyncOutcome;
  try {
    if (group.mode === "mirror") outcome = await syncMirrorGroup(group, opts);
    else if (group.mode === "shared_pool") outcome = await syncSharedPoolGroup(group, opts);
    else outcome = await syncBundleGroup(group, opts);
  } catch (error) {
    outcome = { ok: false, message: error instanceof Error ? error.message : "Unknown error", changes: [] };
  }

  if (!opts.dryRun) {
    await updateGroup(groupId, {
      lastSyncedAt: outcome.ok ? new Date() : null,
      lastError: outcome.ok ? null : outcome.message
    });
    await getPrismaClient().syncLog.create({
      data: {
        storeId: BigInt(group.storeId),
        jobType: `inventory-sync.${group.mode}`,
        status: outcome.ok ? "success" : "failed",
        message: `[${group.name}] ${outcome.message}`,
        startedAt: new Date(),
        completedAt: new Date()
      }
    });
  }

  return outcome;
}
