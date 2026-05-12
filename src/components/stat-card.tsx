import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string | number;
  helper: string;
  icon?: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info";
};

const toneStyles: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "bg-slate-50 text-slate-600",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-rose-50 text-rose-700",
  info: "bg-brandSoft text-brand"
};

export function StatCard({ label, value, helper, icon, tone = "default" }: StatCardProps) {
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-line/70 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">{label}</p>
        {icon ? (
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", toneStyles[tone])}>
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-ink">{value}</p>
      <p className="mt-2 text-xs leading-5 text-muted">{helper}</p>
    </article>
  );
}
