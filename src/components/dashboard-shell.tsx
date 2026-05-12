"use client";

import type { ReactNode } from "react";

import { LiveRefresh } from "@/components/live-refresh";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import type { StoreSummary } from "@/lib/types";

export function DashboardShell({
  children,
  store,
  stores
}: {
  children: ReactNode;
  store: StoreSummary | null;
  stores: StoreSummary[];
}) {
  return (
    <div className="min-h-screen bg-canvas text-ink lg:grid lg:grid-cols-[18rem_minmax(0,1fr)]">
      <LiveRefresh />
      <Sidebar />
      <div className="min-w-0">
        <Topbar store={store} stores={stores} />
        <main className="space-y-8 px-6 py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
