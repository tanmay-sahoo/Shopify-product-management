import { NextRequest, NextResponse } from "next/server";

import { getPrismaClient } from "@/lib/prisma";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const prisma = getPrismaClient();
  try {
    const record = await prisma.store.findUnique({ where: { id: BigInt(id) } });
    if (!record) return NextResponse.json({ error: "Store not found" }, { status: 404 });
    return NextResponse.json({
      item: {
        id: Number(record.id),
        shopDomain: record.shopDomain,
        displayName: (record as { displayName?: string | null }).displayName ?? null,
        status: record.status,
        installedAt: record.installedAt,
        lastSyncAt: record.lastSyncAt,
        scopes: record.scopes ? record.scopes.split(",").filter(Boolean) : []
      }
    });
  } catch {
    return NextResponse.json({ error: "Invalid store id" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = await request.json().catch(() => ({}));
  const data: Record<string, string | null> = {};
  if (typeof payload?.displayName === "string") {
    data.displayName = payload.displayName.trim() || null;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  try {
    const updated = (await getPrismaClient().store.update({
      where: { id: BigInt(id) },
      data: data as Record<string, unknown>
    })) as { id: bigint; displayName?: string | null };
    return NextResponse.json({
      success: true,
      item: { id: Number(updated.id), displayName: updated.displayName ?? null }
    });
  } catch {
    return NextResponse.json({ error: "Failed to update store" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hard = request.nextUrl.searchParams.get("hard") === "true";
  const prisma = getPrismaClient();
  const storeId = BigInt(id);

  try {
    if (!hard) {
      await prisma.store.update({
        where: { id: storeId },
        data: { status: "uninstalled", accessTokenEncrypted: "" }
      });
      return NextResponse.json({ success: true, mode: "soft" });
    }

    await prisma.$transaction([
      prisma.importRow.deleteMany({ where: { import: { storeId } } }),
      prisma.import.deleteMany({ where: { storeId } }),
      prisma.draftChange.deleteMany({ where: { storeId } }),
      prisma.syncLog.deleteMany({ where: { storeId } }),
      prisma.variantImage.deleteMany({ where: { storeId } }),
      prisma.productImage.deleteMany({ where: { storeId } }),
      prisma.variant.deleteMany({ where: { storeId } }),
      prisma.product.deleteMany({ where: { storeId } }),
      prisma.store.delete({ where: { id: storeId } })
    ]);
    return NextResponse.json({ success: true, mode: "hard" });
  } catch {
    return NextResponse.json({ error: "Failed to delete store" }, { status: 400 });
  }
}
