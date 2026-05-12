import { Prisma } from "@prisma/client";

import { getPrismaClient } from "@/lib/prisma";
import { ensureSchemaCompatibility } from "@/lib/schema-bootstrap";

import type { ItemRole, SyncGroup, SyncGroupItem, SyncGroupWithItems, SyncMode } from "./types";

type GroupRow = {
  id: bigint;
  storeId: bigint;
  name: string;
  mode: SyncMode;
  syncStock: number;
  syncPrice: number;
  active: number;
  lastSyncedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ItemRow = {
  id: bigint;
  groupId: bigint;
  storeId: bigint;
  productId: bigint | null;
  variantId: bigint | null;
  shopifyProductId: string | null;
  shopifyVariantId: string;
  inventoryItemId: string | null;
  locationId: string | null;
  role: ItemRole;
  quantityRequired: number;
  stockBuffer: number;
  priceMultiplier: Prisma.Decimal;
  syncStock: number;
  syncPrice: number;
  active: number;
};

function mapGroup(row: GroupRow): SyncGroup {
  return {
    id: Number(row.id),
    storeId: Number(row.storeId),
    name: row.name,
    mode: row.mode,
    syncStock: row.syncStock === 1,
    syncPrice: row.syncPrice === 1,
    active: row.active === 1,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function mapItem(row: ItemRow): SyncGroupItem {
  return {
    id: Number(row.id),
    groupId: Number(row.groupId),
    storeId: Number(row.storeId),
    productId: row.productId !== null ? Number(row.productId) : null,
    variantId: row.variantId !== null ? Number(row.variantId) : null,
    shopifyProductId: row.shopifyProductId,
    shopifyVariantId: row.shopifyVariantId,
    inventoryItemId: row.inventoryItemId,
    locationId: row.locationId,
    role: row.role,
    quantityRequired: row.quantityRequired,
    stockBuffer: row.stockBuffer,
    priceMultiplier: Number(row.priceMultiplier),
    syncStock: row.syncStock === 1,
    syncPrice: row.syncPrice === 1,
    active: row.active === 1
  };
}

async function loadGroupRow(id: number): Promise<GroupRow | null> {
  await ensureSchemaCompatibility();
  const rows = await getPrismaClient().$queryRaw<GroupRow[]>(
    Prisma.sql`SELECT * FROM \`InventorySyncGroup\` WHERE id = ${BigInt(id)}`
  );
  return rows[0] ?? null;
}

export async function getGroup(id: number): Promise<SyncGroupWithItems | null> {
  const row = await loadGroupRow(id);
  if (!row) return null;
  const items = await getGroupItems(id);
  return { ...mapGroup(row), items };
}

export async function getGroupItems(groupId: number): Promise<SyncGroupItem[]> {
  await ensureSchemaCompatibility();
  const rows = await getPrismaClient().$queryRaw<ItemRow[]>(
    Prisma.sql`SELECT * FROM \`InventorySyncGroupItem\` WHERE groupId = ${BigInt(groupId)} ORDER BY id ASC`
  );
  return rows.map(mapItem);
}

export async function listGroups(
  storeId: number,
  filters: { mode?: SyncMode; active?: boolean; search?: string } = {}
): Promise<SyncGroupWithItems[]> {
  await ensureSchemaCompatibility();
  const prisma = getPrismaClient();
  const where: Prisma.Sql[] = [Prisma.sql`storeId = ${BigInt(storeId)}`];
  if (filters.mode) where.push(Prisma.sql`mode = ${filters.mode}`);
  if (filters.active !== undefined) where.push(Prisma.sql`active = ${filters.active ? 1 : 0}`);
  if (filters.search) {
    const like = `%${filters.search}%`;
    where.push(Prisma.sql`name LIKE ${like}`);
  }
  const whereSql = Prisma.join(where, " AND ");
  const groupRows = await prisma.$queryRaw<GroupRow[]>(
    Prisma.sql`SELECT * FROM \`InventorySyncGroup\` WHERE ${whereSql} ORDER BY createdAt DESC`
  );
  if (groupRows.length === 0) return [];
  const groupIds = groupRows.map((row) => row.id);
  const itemRows = await prisma.$queryRaw<ItemRow[]>(
    Prisma.sql`SELECT * FROM \`InventorySyncGroupItem\` WHERE groupId IN (${Prisma.join(groupIds)}) ORDER BY id ASC`
  );
  const byGroup = new Map<string, SyncGroupItem[]>();
  for (const row of itemRows) {
    const list = byGroup.get(String(row.groupId)) ?? [];
    list.push(mapItem(row));
    byGroup.set(String(row.groupId), list);
  }
  return groupRows.map((row) => ({ ...mapGroup(row), items: byGroup.get(String(row.id)) ?? [] }));
}

export async function createGroup(
  storeId: number,
  input: { name: string; mode: SyncMode; syncStock: boolean; syncPrice: boolean; active: boolean }
): Promise<number> {
  await ensureSchemaCompatibility();
  await getPrismaClient().$executeRaw(
    Prisma.sql`INSERT INTO \`InventorySyncGroup\` (storeId, name, mode, syncStock, syncPrice, active, updatedAt)
               VALUES (${BigInt(storeId)}, ${input.name}, ${input.mode}, ${input.syncStock ? 1 : 0}, ${input.syncPrice ? 1 : 0}, ${input.active ? 1 : 0}, NOW(3))`
  );
  const rows = await getPrismaClient().$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT LAST_INSERT_ID() AS id`);
  return Number(rows[0]?.id ?? 0);
}

export async function updateGroup(
  id: number,
  patch: Partial<{
    name: string;
    mode: SyncMode;
    syncStock: boolean;
    syncPrice: boolean;
    active: boolean;
    lastSyncedAt: Date | null;
    lastError: string | null;
  }>
): Promise<void> {
  await ensureSchemaCompatibility();
  const sets: Prisma.Sql[] = [];
  if (patch.name !== undefined) sets.push(Prisma.sql`name = ${patch.name}`);
  if (patch.mode !== undefined) sets.push(Prisma.sql`mode = ${patch.mode}`);
  if (patch.syncStock !== undefined) sets.push(Prisma.sql`syncStock = ${patch.syncStock ? 1 : 0}`);
  if (patch.syncPrice !== undefined) sets.push(Prisma.sql`syncPrice = ${patch.syncPrice ? 1 : 0}`);
  if (patch.active !== undefined) sets.push(Prisma.sql`active = ${patch.active ? 1 : 0}`);
  if (patch.lastSyncedAt !== undefined) sets.push(Prisma.sql`lastSyncedAt = ${patch.lastSyncedAt}`);
  if (patch.lastError !== undefined) sets.push(Prisma.sql`lastError = ${patch.lastError}`);
  if (sets.length === 0) return;
  sets.push(Prisma.sql`updatedAt = NOW(3)`);
  await getPrismaClient().$executeRaw(
    Prisma.sql`UPDATE \`InventorySyncGroup\` SET ${Prisma.join(sets, ", ")} WHERE id = ${BigInt(id)}`
  );
}

export async function deleteGroup(id: number): Promise<void> {
  await ensureSchemaCompatibility();
  await getPrismaClient().$executeRaw(
    Prisma.sql`DELETE FROM \`InventorySyncGroup\` WHERE id = ${BigInt(id)}`
  );
}

export async function createGroupItem(input: {
  groupId: number;
  storeId: number;
  productId: number | null;
  variantId: number | null;
  shopifyProductId: string | null;
  shopifyVariantId: string;
  inventoryItemId: string | null;
  locationId: string | null;
  role: ItemRole;
  quantityRequired?: number;
  stockBuffer?: number;
  priceMultiplier?: number;
  syncStock?: boolean;
  syncPrice?: boolean;
  active?: boolean;
}): Promise<number> {
  await ensureSchemaCompatibility();
  await getPrismaClient().$executeRaw(
    Prisma.sql`INSERT INTO \`InventorySyncGroupItem\`
      (groupId, storeId, productId, variantId, shopifyProductId, shopifyVariantId, inventoryItemId, locationId,
       role, quantityRequired, stockBuffer, priceMultiplier, syncStock, syncPrice, active, updatedAt)
      VALUES
      (${BigInt(input.groupId)}, ${BigInt(input.storeId)},
       ${input.productId !== null ? BigInt(input.productId) : null},
       ${input.variantId !== null ? BigInt(input.variantId) : null},
       ${input.shopifyProductId}, ${input.shopifyVariantId}, ${input.inventoryItemId}, ${input.locationId},
       ${input.role}, ${input.quantityRequired ?? 1}, ${input.stockBuffer ?? 0},
       ${new Prisma.Decimal(input.priceMultiplier ?? 1)},
       ${input.syncStock === false ? 0 : 1}, ${input.syncPrice === true ? 1 : 0}, ${input.active === false ? 0 : 1},
       NOW(3))`
  );
  const rows = await getPrismaClient().$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT LAST_INSERT_ID() AS id`);
  return Number(rows[0]?.id ?? 0);
}

export async function updateGroupItem(
  id: number,
  patch: Partial<Omit<SyncGroupItem, "id" | "groupId" | "storeId">>
): Promise<void> {
  await ensureSchemaCompatibility();
  const sets: Prisma.Sql[] = [];
  if (patch.productId !== undefined)
    sets.push(Prisma.sql`productId = ${patch.productId !== null ? BigInt(patch.productId) : null}`);
  if (patch.variantId !== undefined)
    sets.push(Prisma.sql`variantId = ${patch.variantId !== null ? BigInt(patch.variantId) : null}`);
  if (patch.shopifyProductId !== undefined) sets.push(Prisma.sql`shopifyProductId = ${patch.shopifyProductId}`);
  if (patch.shopifyVariantId !== undefined) sets.push(Prisma.sql`shopifyVariantId = ${patch.shopifyVariantId}`);
  if (patch.inventoryItemId !== undefined) sets.push(Prisma.sql`inventoryItemId = ${patch.inventoryItemId}`);
  if (patch.locationId !== undefined) sets.push(Prisma.sql`locationId = ${patch.locationId}`);
  if (patch.role !== undefined) sets.push(Prisma.sql`role = ${patch.role}`);
  if (patch.quantityRequired !== undefined) sets.push(Prisma.sql`quantityRequired = ${patch.quantityRequired}`);
  if (patch.stockBuffer !== undefined) sets.push(Prisma.sql`stockBuffer = ${patch.stockBuffer}`);
  if (patch.priceMultiplier !== undefined)
    sets.push(Prisma.sql`priceMultiplier = ${new Prisma.Decimal(patch.priceMultiplier)}`);
  if (patch.syncStock !== undefined) sets.push(Prisma.sql`syncStock = ${patch.syncStock ? 1 : 0}`);
  if (patch.syncPrice !== undefined) sets.push(Prisma.sql`syncPrice = ${patch.syncPrice ? 1 : 0}`);
  if (patch.active !== undefined) sets.push(Prisma.sql`active = ${patch.active ? 1 : 0}`);
  if (sets.length === 0) return;
  sets.push(Prisma.sql`updatedAt = NOW(3)`);
  await getPrismaClient().$executeRaw(
    Prisma.sql`UPDATE \`InventorySyncGroupItem\` SET ${Prisma.join(sets, ", ")} WHERE id = ${BigInt(id)}`
  );
}

export async function deleteGroupItem(id: number): Promise<void> {
  await ensureSchemaCompatibility();
  await getPrismaClient().$executeRaw(
    Prisma.sql`DELETE FROM \`InventorySyncGroupItem\` WHERE id = ${BigInt(id)}`
  );
}

export async function findActiveItemsByVariantGid(
  storeId: number,
  shopifyVariantId: string
): Promise<SyncGroupItem[]> {
  await ensureSchemaCompatibility();
  const rows = await getPrismaClient().$queryRaw<ItemRow[]>(
    Prisma.sql`SELECT i.* FROM \`InventorySyncGroupItem\` i
               JOIN \`InventorySyncGroup\` g ON g.id = i.groupId
               WHERE i.storeId = ${BigInt(storeId)}
                 AND i.shopifyVariantId = ${shopifyVariantId}
                 AND i.active = 1
                 AND g.active = 1`
  );
  return rows.map(mapItem);
}

export async function findActiveItemsByInventoryItemGid(
  storeId: number,
  inventoryItemId: string
): Promise<SyncGroupItem[]> {
  await ensureSchemaCompatibility();
  const rows = await getPrismaClient().$queryRaw<ItemRow[]>(
    Prisma.sql`SELECT i.* FROM \`InventorySyncGroupItem\` i
               JOIN \`InventorySyncGroup\` g ON g.id = i.groupId
               WHERE i.storeId = ${BigInt(storeId)}
                 AND i.inventoryItemId = ${inventoryItemId}
                 AND i.active = 1
                 AND g.active = 1`
  );
  return rows.map(mapItem);
}

export async function resolveVariantIdByInventoryItemId(
  storeId: number,
  inventoryItemId: string
): Promise<string | null> {
  const variant = await getPrismaClient().variant.findFirst({
    where: { storeId: BigInt(storeId), inventoryItemId },
    select: { shopifyVariantId: true }
  });
  return variant?.shopifyVariantId ?? null;
}

export async function backfillInventoryItemIdForVariant(
  storeId: number,
  shopifyVariantId: string
): Promise<string | null> {
  const variant = await getPrismaClient().variant.findFirst({
    where: { storeId: BigInt(storeId), shopifyVariantId },
    select: { inventoryItemId: true }
  });
  return variant?.inventoryItemId ?? null;
}
