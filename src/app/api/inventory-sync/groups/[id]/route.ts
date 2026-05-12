import { NextRequest, NextResponse } from "next/server";

import { deleteGroup, getGroup, updateGroup } from "@/lib/inventory-sync/repo";
import type { SyncMode } from "@/lib/inventory-sync/types";

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  const group = await getGroup(numId);
  if (!group) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, group });
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });

  const body = (await request.json()) as {
    name?: string;
    mode?: SyncMode;
    syncStock?: boolean;
    syncPrice?: boolean;
    active?: boolean;
  };

  await updateGroup(numId, body);
  const group = await getGroup(numId);
  return NextResponse.json({ ok: true, group });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  await deleteGroup(numId);
  return NextResponse.json({ ok: true });
}
