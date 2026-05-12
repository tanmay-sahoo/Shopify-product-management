import { NextResponse } from "next/server";

import { listConnectedStores } from "@/lib/data-service";

export async function GET() {
  const items = await listConnectedStores();
  return NextResponse.json({ items });
}
