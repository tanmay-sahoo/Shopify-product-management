import { NextResponse } from "next/server";

import { getImport, listImportRowDetails } from "@/lib/import-jobs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const importId = Number(id);
  if (!Number.isInteger(importId) || importId <= 0) {
    return NextResponse.json({ error: "Invalid import id" }, { status: 400 });
  }
  const job = await getImport(BigInt(importId));
  if (!job) return NextResponse.json({ job: null });
  // Surface up to 50 row outcomes so the UI can show per-product status without
  // a second fetch. Truncated to keep response small.
  const rows = await listImportRowDetails(BigInt(importId));
  return NextResponse.json({ job, rows: rows.slice(0, 500) });
}
