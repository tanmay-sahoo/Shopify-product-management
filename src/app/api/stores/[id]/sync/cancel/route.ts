import { NextResponse } from "next/server";

import { cancelRunningSyncJobs } from "@/lib/sync-jobs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storeId = Number(id);
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ error: "Invalid store id" }, { status: 400 });
  }
  const cancelled = await cancelRunningSyncJobs(BigInt(storeId));
  return NextResponse.json({ success: true, cancelled });
}
