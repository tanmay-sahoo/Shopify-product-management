import { NextResponse } from "next/server";

import { syncLogs } from "@/lib/mock-data";

export async function GET() {
  return NextResponse.json({ items: syncLogs });
}
