import { NextResponse } from "next/server";

import { getActiveStoreIdOrThrow } from "@/lib/drafts";
import { getImport, hasRunningImport, startImportPush } from "@/lib/import-jobs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const importId = Number(id);
  if (!Number.isInteger(importId) || importId <= 0) {
    return NextResponse.json({ error: "Invalid import id" }, { status: 400 });
  }
  let storeId: number;
  try {
    storeId = await getActiveStoreIdOrThrow();
  } catch {
    return NextResponse.json({ error: "Connect a Shopify store before importing." }, { status: 400 });
  }

  const job = await getImport(BigInt(importId));
  if (!job) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  if (String(job.storeId) !== String(storeId)) {
    return NextResponse.json({ error: "Import belongs to another store" }, { status: 400 });
  }
  if (await hasRunningImport(BigInt(storeId))) {
    return NextResponse.json({ success: true, alreadyRunning: true, job });
  }

  startImportPush(BigInt(importId), BigInt(storeId));
  return NextResponse.json({ success: true, queued: true });
}
