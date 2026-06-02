import { NextResponse } from "next/server";

// UTF-8 byte order mark (U+FEFF).
//
// Our CSV bodies are already valid UTF-8 (the runtime encodes string responses
// as UTF-8), so German umlauts (ä ö ü ß), typographic symbols, and emoji are
// preserved on the wire. The problem is the *reader*: Excel on Windows opens a
// `.csv` using the machine's ANSI codepage (Windows-1252) unless a BOM is
// present, which mangles those characters into `?` / `�`. Prepending this BOM
// makes Excel — and LibreOffice, Numbers, Google Sheets — auto-detect UTF-8.
export const UTF8_BOM = "﻿";

// Build a downloadable CSV response with a UTF-8 BOM so special characters
// survive being opened in spreadsheet apps. Always route CSV downloads through
// this helper rather than constructing a Response by hand.
export function csvResponse(csv: string, fileName: string): NextResponse {
  return new NextResponse(UTF8_BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`
    }
  });
}
