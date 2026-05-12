import { DashboardShell } from "@/components/dashboard-shell";
import { NoStoreConnected } from "@/components/empty-state";
import { ImportUploader } from "@/components/import-uploader";
import { SectionHeader } from "@/components/section-header";
import { getDashboardData } from "@/lib/data-service";

export default async function ImportsPage() {
  const { importSummary, store, stores } = await getDashboardData();

  return (
    <DashboardShell store={store} stores={stores}>
      <SectionHeader
        title="Bulk Import"
        description="Upload a CSV with horizontal image columns. Rows are validated client-side and approved rows are staged as draft changes before pushing to Shopify."
      />
      {store ? <ImportUploader initial={importSummary} /> : <NoStoreConnected />}
    </DashboardShell>
  );
}
