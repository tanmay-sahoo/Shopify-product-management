import { DashboardShell } from "@/components/dashboard-shell";
import { DatabaseUnreachable, NoStoreConnected } from "@/components/empty-state";
import { ImportUploader } from "@/components/import-uploader";
import { SectionHeader } from "@/components/section-header";
import { getDashboardData } from "@/lib/data-service";

export default async function ImportsPage() {
  const { importSummary, store, stores, dbError } = await getDashboardData();

  return (
    <DashboardShell store={store} stores={stores}>
      <SectionHeader
        title="Bulk Import"
        description="Upload a CSV to bulk-update Products or Collections. Choose the import type below. Collection uploads match by ID (same shop) or by Handle (another shop — creates missing collections), and run as tracked import jobs."
      />
      {dbError ? (
        <DatabaseUnreachable />
      ) : store ? (
        <ImportUploader initial={importSummary} />
      ) : (
        <NoStoreConnected />
      )}
    </DashboardShell>
  );
}
