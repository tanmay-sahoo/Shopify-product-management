import { Prisma } from "@prisma/client";

import { readActiveStoreId } from "@/lib/active-store";
import { getPrismaClient } from "@/lib/prisma";
import { ensureSchemaCompatibility } from "@/lib/schema-bootstrap";

type EntityType = "product" | "variant" | "image" | "inventory" | "metafield";
type ChangeType = "create" | "update" | "delete";

export type DraftInput = {
  entityType: EntityType;
  entityId?: number | bigint | null;
  shopifyEntityId?: string | null;
  changeType: ChangeType;
  beforeData?: unknown;
  afterData?: unknown;
};

function toJsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  const cleaned = JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v))
  );
  return cleaned as Prisma.InputJsonValue;
}

export async function getActiveStoreIdOrThrow(): Promise<number> {
  await ensureSchemaCompatibility();
  const cookieId = await readActiveStoreId();
  if (cookieId) {
    const exists = await getPrismaClient().store.findFirst({
      where: { id: BigInt(cookieId), status: { not: "uninstalled" } },
      select: { id: true }
    });
    if (exists) return cookieId;
  }

  const fallback = await getPrismaClient().store.findFirst({
    where: { status: { not: "uninstalled" } },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: { id: true }
  });
  if (fallback) return Number(fallback.id);

  throw new Error("NO_ACTIVE_STORE");
}

export async function createDraftChange(input: DraftInput) {
  await ensureSchemaCompatibility();
  const storeId = await getActiveStoreIdOrThrow();
  const prisma = getPrismaClient();

  return prisma.draftChange.create({
    data: {
      storeId: BigInt(storeId),
      entityType: input.entityType,
      entityId:
        input.entityId === undefined || input.entityId === null
          ? null
          : BigInt(input.entityId),
      shopifyEntityId: input.shopifyEntityId ?? null,
      changeType: input.changeType,
      beforeData: toJsonInput(input.beforeData),
      afterData: toJsonInput(input.afterData),
      status: "draft"
    }
  });
}

export async function createDraftChanges(inputs: DraftInput[]) {
  await ensureSchemaCompatibility();
  const storeId = await getActiveStoreIdOrThrow();
  const prisma = getPrismaClient();

  return prisma.draftChange.createMany({
    data: inputs.map((input) => ({
      storeId: BigInt(storeId),
      entityType: input.entityType,
      entityId:
        input.entityId === undefined || input.entityId === null
          ? null
          : BigInt(input.entityId),
      shopifyEntityId: input.shopifyEntityId ?? null,
      changeType: input.changeType,
      beforeData: toJsonInput(input.beforeData),
      afterData: toJsonInput(input.afterData),
      status: "draft" as const
    }))
  });
}

export function noActiveStoreResponse() {
  return {
    status: 400,
    body: { error: "Connect a Shopify store before staging changes." }
  };
}
