import { Badge } from "@/components/badge";
import type { ImportSummary } from "@/lib/types";

export function ImportPreviewTable({ summary }: { summary: ImportSummary }) {
  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-line bg-panel shadow-panel">
      <div className="border-b border-line px-6 py-5">
        <h4 className="text-lg font-semibold text-ink">Validation preview</h4>
        <p className="mt-2 text-sm text-muted">
          Horizontal image columns are read left to right and grouped per variant row.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-muted">
            <tr>
              {["Row", "Handle", "SKU", "Action", "Images", "Status", "Errors"].map((label) => (
                <th key={label} className="px-6 py-4 font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr key={row.rowNumber} className="border-t border-line align-top">
                <td className="px-6 py-5 text-muted">{row.rowNumber}</td>
                <td className="px-6 py-5 font-medium text-ink">{row.handle}</td>
                <td className="px-6 py-5 text-muted">{row.sku}</td>
                <td className="px-6 py-5 text-muted">{row.actionType}</td>
                <td className="px-6 py-5 text-muted">{row.imageColumns.filter(Boolean).length}</td>
                <td className="px-6 py-5">
                  <Badge tone={row.validationStatus}>{row.validationStatus}</Badge>
                </td>
                <td className="px-6 py-5 text-muted">
                  {row.validationErrors.length ? row.validationErrors.join("; ") : "No issues"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
