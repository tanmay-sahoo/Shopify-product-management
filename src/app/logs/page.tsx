import { DashboardShell } from "@/components/dashboard-shell";
import { NoStoreConnected } from "@/components/empty-state";
import { LogList } from "@/components/log-list";
import { SectionHeader } from "@/components/section-header";
import { getDashboardData } from "@/lib/data-service";

export default async function LogsPage() {
  const { store, stores, syncLogs } = await getDashboardData();

  return (
    <DashboardShell store={store} stores={stores}>
      <SectionHeader
        title="Sync Logs"
        description="Queue job status, retry visibility, and audit-friendly sync history for product, import, and push operations."
      />
      {store ? <LogList logs={syncLogs} /> : <NoStoreConnected />}
    </DashboardShell>
  );
}
