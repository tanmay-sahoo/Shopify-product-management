import type { ImportRow } from "@/lib/types";
import { validateImportRows } from "@/lib/validation";

export function parseCsvText(csvText: string) {
  const [headerLine, ...lines] = csvText.trim().split(/\r?\n/);
  const headers = splitCsvLine(headerLine);

  const records = lines.map((line, index) => {
    const values = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]));
    const imageColumns = headers
      .filter((header) => /^image\s+\d+$/i.test(header))
      .map((header) => row[header] ?? "");

    return {
      rowNumber: index + 2,
      handle: row.Handle ?? row.handle ?? "",
      sku: row.SKU ?? row.sku ?? "",
      title: row.Title ?? row.title ?? "",
      price: row.Price ?? row.price ?? "",
      inventory: row.Inventory ?? row.inventory ?? "",
      imageColumns
    };
  });

  return validateImportRows(records as Omit<ImportRow, "validationErrors" | "validationStatus" | "actionType">[]);
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());

  return values;
}
