import { NextRequest, NextResponse } from "next/server";

import { getPrismaClient } from "@/lib/prisma";

type Status = "draft" | "approved" | "rejected" | "pushed" | "failed";
const ALLOWED: Status[] = ["draft", "approved", "rejected", "pushed", "failed"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const payload = await request.json().catch(() => ({}));
  const nextStatus = payload?.status as Status | undefined;
  if (!nextStatus || !ALLOWED.includes(nextStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  try {
    const updated = await getPrismaClient().draftChange.update({
      where: { id: BigInt(id) },
      data: { status: nextStatus }
    });
    return NextResponse.json({
      success: true,
      item: {
        id: Number(updated.id),
        status: updated.status
      }
    });
  } catch {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await getPrismaClient().draftChange.delete({ where: { id: BigInt(id) } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
}
