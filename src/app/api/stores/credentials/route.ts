import { NextResponse } from "next/server";

import { getPrismaClient } from "@/lib/prisma";

export async function GET() {
  const prisma = getPrismaClient();
  try {
    const stores = await prisma.store.findMany({
      where: { shopifyClientId: { not: null }, shopifyClientSecretEncrypted: { not: null } },
      orderBy: { updatedAt: "desc" }
    });
    const seen = new Set<string>();
    const items: {
      clientId: string;
      shopDomain: string;
      label: string;
    }[] = [];
    for (const store of stores) {
      if (!store.shopifyClientId) continue;
      if (seen.has(store.shopifyClientId)) continue;
      seen.add(store.shopifyClientId);
      const displayName = (store as { displayName?: string | null }).displayName ?? null;
      items.push({
        clientId: store.shopifyClientId,
        shopDomain: store.shopDomain,
        label: displayName ?? store.shopDomain
      });
    }
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
