import { NextResponse } from "next/server";

export async function GET(_: Request, { params }: { params: Promise<{ exportId: string }> }) {
  const { exportId } = await params;
  return NextResponse.json({
    item: {
      id: exportId,
      status: "completed",
      fileUrl: `/api/products/export`
    }
  });
}
