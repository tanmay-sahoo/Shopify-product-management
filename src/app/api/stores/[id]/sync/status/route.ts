import { NextResponse } from "next/server";

import { getLatestSyncJob } from "@/lib/sync-jobs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storeId = Number(id);
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ error: "Invalid store id" }, { status: 400 });
  }
  const job = await getLatestSyncJob(BigInt(storeId));
  return NextResponse.json({ job });
}
