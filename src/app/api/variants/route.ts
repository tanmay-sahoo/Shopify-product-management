import { NextResponse } from "next/server";

import { variants } from "@/lib/mock-data";

export async function GET() {
  return NextResponse.json({ items: variants });
}
