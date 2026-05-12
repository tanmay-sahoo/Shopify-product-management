import { NextResponse } from "next/server";

import { importSummary } from "@/lib/mock-data";

export async function GET() {
  const rows = importSummary.rows
    .filter((row) => row.validationStatus === "error")
    .map((row) => `${row.rowNumber},${row.handle},${row.sku},"${row.validationErrors.join(" | ")}"`)
    .join("\n");

  const csv = `Row,Handle,SKU,Errors\n${rows}`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="import-errors.csv"'
    }
  });
}
