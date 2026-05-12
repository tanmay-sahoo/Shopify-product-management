import { NextResponse } from "next/server";

import { getDashboardData } from "@/lib/data-service";
import { toEnhancedCsv } from "@/lib/export";

async function exportProductsCsv() {
  const { products, store } = await getDashboardData();
  if (!store) {
    return NextResponse.json({ error: "No store connected. Connect a Shopify store first." }, { status: 400 });
  }
  const csv = toEnhancedCsv(products, { shopDomain: store.shopDomain });

  const fileName = `products-export-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`
    }
  });
}

export async function POST() {
  return exportProductsCsv();
}

export async function GET() {
  return exportProductsCsv();
}
