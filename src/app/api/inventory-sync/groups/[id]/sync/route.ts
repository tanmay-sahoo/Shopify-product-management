import { NextRequest, NextResponse } from "next/server";

import { syncGroup } from "@/lib/inventory-sync/sync";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  const url = request.nextUrl;
  const dryRun = url.searchParams.get("dryRun") === "true";
  const outcome = await syncGroup(numId, { dryRun, trigger: dryRun ? "dry-run" : "manual" });
  return NextResponse.json(outcome);
}
