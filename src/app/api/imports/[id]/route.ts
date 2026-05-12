import { NextResponse } from "next/server";

import { importSummary } from "@/lib/mock-data";

export async function GET() {
  return NextResponse.json({ item: importSummary });
}
