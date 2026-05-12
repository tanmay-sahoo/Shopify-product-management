import { NextResponse } from "next/server";

import { getPrismaClient } from "@/lib/prisma";
import { readActiveStoreId } from "@/lib/active-store";

export async function GET() {
  const prisma = getPrismaClient();
  const activeId = await readActiveStoreId();
  try {
    const where = activeId ? { storeId: BigInt(activeId) } : {};
    const rows = await prisma.draftChange.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return NextResponse.json({
      items: rows.map((row) => ({
        id: Number(row.id),
        entityType: row.entityType,
        changeType: row.changeType,
        status: row.status,
        summary: `${row.entityType} ${row.changeType}`,
        createdAt: row.createdAt.toISOString()
      }))
    });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
