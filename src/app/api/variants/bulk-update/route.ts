import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const payload = await request.json();

  return NextResponse.json({
    success: true,
    queued: true,
    selectionCount: Array.isArray(payload.ids) ? payload.ids.length : 0
  });
}
