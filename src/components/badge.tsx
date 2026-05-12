import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { ValidationLevel } from "@/lib/types";

export function Badge({
  children,
  tone = "neutral"
}: {
  children: ReactNode;
  tone?: ValidationLevel | "neutral" | "info";
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize",
        tone === "valid" && "bg-emerald-100 text-emerald-700",
        tone === "warning" && "bg-amber-100 text-amber-700",
        tone === "error" && "bg-rose-100 text-rose-700",
        tone === "info" && "bg-brandSoft text-brand",
        tone === "neutral" && "bg-slate-100 text-slate-700"
      )}
    >
      {children}
    </span>
  );
}
