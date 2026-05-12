import { NextRequest, NextResponse } from "next/server";

import { parseCsvText } from "@/lib/imports";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload a CSV file" }, { status: 400 });
  }

  const contents = await file.text();
  const rows = parseCsvText(contents);
  const errors = rows.filter((row) => row.validationStatus === "error").length;
  const warnings = rows.filter((row) => row.validationStatus === "warning").length;

  return NextResponse.json({
    success: true,
    item: {
      fileName: file.name,
      totalRows: rows.length,
      validRows: rows.filter((row) => row.validationStatus === "valid").length,
      warningRows: warnings,
      errorRows: errors,
      rows
    }
  });
}
