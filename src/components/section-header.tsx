import type { ReactNode } from "react";

export function SectionHeader({
  title,
  description,
  actions
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h3 className="text-xl font-semibold tracking-tight text-ink">{title}</h3>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{description}</p>
      </div>
      {actions}
    </div>
  );
}
