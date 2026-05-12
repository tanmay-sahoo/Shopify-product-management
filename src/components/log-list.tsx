import { Badge } from "@/components/badge";
import type { DraftChange, SyncLog } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export function LogList({ logs }: { logs: SyncLog[] }) {
  return (
    <div className="space-y-4">
      {logs.map((log) => (
        <div key={log.id} className="rounded-[1.5rem] border border-line bg-panel p-5 shadow-panel">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-semibold text-ink">{log.jobType}</p>
              <p className="mt-2 text-sm text-muted">{log.message}</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge
                tone={
                  log.status === "success"
                    ? "valid"
                    : log.status === "failed"
                      ? "error"
                      : log.status === "partial"
                        ? "warning"
                        : "info"
                }
              >
                {log.status}
              </Badge>
              <span className="text-sm text-muted">{formatDate(log.createdAt)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DraftChangeList({ changes }: { changes: DraftChange[] }) {
  return (
    <div className="space-y-4">
      {changes.map((change) => (
        <div key={change.id} className="rounded-[1.5rem] border border-line bg-panel p-5 shadow-panel">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-semibold text-ink">{change.summary}</p>
              <p className="mt-2 text-sm capitalize text-muted">
                {change.entityType} {change.changeType}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={change.status === "failed" ? "error" : change.status === "draft" ? "warning" : "info"}>
                {change.status}
              </Badge>
              <span className="text-sm text-muted">{formatDate(change.createdAt)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
