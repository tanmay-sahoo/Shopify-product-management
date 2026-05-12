// Lightweight in-memory loop guard. After we write a quantity to Shopify, the
// subsequent inventory_levels/update webhook for that same item/location should
// be ignored so we don't bounce. Keyed by storeId|inventoryItemId|locationId.
//
// This guard is process-local. In multi-instance deployments it is best-effort;
// the sync layer also short-circuits "already at this value" updates as a
// second line of defense.

const TTL_MS = 30_000;

type Entry = { quantity: number; at: number };
const recent = new Map<string, Entry>();

function key(storeId: number, inventoryItemId: string, locationId: string) {
  return `${storeId}|${inventoryItemId}|${locationId}`;
}

export function markWrite(storeId: number, inventoryItemId: string, locationId: string, quantity: number) {
  recent.set(key(storeId, inventoryItemId, locationId), { quantity, at: Date.now() });
}

export function isOurOwnEcho(
  storeId: number,
  inventoryItemId: string,
  locationId: string,
  observed: number
): boolean {
  const entry = recent.get(key(storeId, inventoryItemId, locationId));
  if (!entry) return false;
  if (Date.now() - entry.at > TTL_MS) {
    recent.delete(key(storeId, inventoryItemId, locationId));
    return false;
  }
  return entry.quantity === observed;
}

const orderTracker = new Map<string, number>();
const ORDER_TTL_MS = 24 * 60 * 60 * 1000;

export function markOrderProcessed(storeId: number, orderId: string, topic: string) {
  orderTracker.set(`${storeId}|${topic}|${orderId}`, Date.now());
  for (const [k, ts] of orderTracker) {
    if (Date.now() - ts > ORDER_TTL_MS) orderTracker.delete(k);
  }
}

export function wasOrderProcessed(storeId: number, orderId: string, topic: string): boolean {
  const ts = orderTracker.get(`${storeId}|${topic}|${orderId}`);
  if (!ts) return false;
  if (Date.now() - ts > ORDER_TTL_MS) {
    orderTracker.delete(`${storeId}|${topic}|${orderId}`);
    return false;
  }
  return true;
}
