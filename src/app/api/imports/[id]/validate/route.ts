import { NextResponse } from "next/server";

import { importSummary } from "@/lib/mock-data";

export async function POST() {
  return NextResponse.json({
    success: true,
    item: importSummary
  });
}
