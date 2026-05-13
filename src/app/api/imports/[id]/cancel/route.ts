import { NextResponse } from "next/server";

import { cancelImport } from "@/lib/import-jobs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const importId = Number(id);
  if (!Number.isInteger(importId) || importId <= 0) {
    return NextResponse.json({ error: "Invalid import id" }, { status: 400 });
  }
  await cancelImport(BigInt(importId));
  return NextResponse.json({ success: true });
}
