import { NextResponse } from "next/server";

import { hasRunningSyncJob, startSyncJob } from "@/lib/sync-jobs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storeId = Number(id);

  if (!Number.isInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ error: "Invalid store id" }, { status: 400 });
  }

  try {
    const storeBigId = BigInt(storeId);
    if (await hasRunningSyncJob(storeBigId)) {
      return NextResponse.json(
        { success: true, alreadyRunning: true, message: "A sync is already running for this store." },
        { status: 200 }
      );
    }
    const job = await startSyncJob(storeBigId);
    return NextResponse.json({
      success: true,
      queued: true,
      storeId,
      jobType: "shopify.initialSync",
      job
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ success: false, storeId, error: message }, { status: 500 });
  }
}
