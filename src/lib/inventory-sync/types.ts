export type SyncMode = "mirror" | "shared_pool" | "bundle";
export type ItemRole = "source" | "target" | "component" | "combo" | "member";

export type SyncGroup = {
  id: number;
  storeId: number;
  name: string;
  mode: SyncMode;
  syncStock: boolean;
  syncPrice: boolean;
  active: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncGroupItem = {
  id: number;
  groupId: number;
  storeId: number;
  productId: number | null;
  variantId: number | null;
  shopifyProductId: string | null;
  shopifyVariantId: string;
  inventoryItemId: string | null;
  locationId: string | null;
  role: ItemRole;
  quantityRequired: number;
  stockBuffer: number;
  priceMultiplier: number;
  syncStock: boolean;
  syncPrice: boolean;
  active: boolean;
};

export type SyncGroupWithItems = SyncGroup & { items: SyncGroupItem[] };

export type SyncOutcome = {
  ok: boolean;
  message: string;
  dryRun?: boolean;
  changes: Array<{
    variantId: string;
    inventoryItemId?: string | null;
    field: "stock" | "price";
    from: number | null;
    to: number;
    applied: boolean;
  }>;
};
