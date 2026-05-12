import { NextResponse } from "next/server";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return NextResponse.json({
    success: true,
    importId: Number(id),
    queuedJobs: [
      "shopify.pushProducts",
      "shopify.pushVariants",
      "shopify.pushImages",
      "shopify.updateInventory"
    ]
  });
}
