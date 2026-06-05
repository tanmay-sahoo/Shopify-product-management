import { DashboardShell } from "@/components/dashboard-shell";
import { DraftsBoard } from "@/components/drafts-board";
import { DatabaseUnreachable, NoStoreConnected } from "@/components/empty-state";
import { SectionHeader } from "@/components/section-header";
import { getDashboardData } from "@/lib/data-service";

export default async function DraftsPage() {
  const { draftChanges, store, stores, dbError } = await getDashboardData();

  return (
    <DashboardShell store={store} stores={stores}>
      <SectionHeader
        title="Draft Changes"
        description="Approve or reject staged changes before pushing them to Shopify. Use bulk select to approve and push many at once."
      />
      {dbError ? (
        <DatabaseUnreachable />
      ) : store ? (
        <DraftsBoard changes={draftChanges} store={store} />
      ) : (
        <NoStoreConnected />
      )}
    </DashboardShell>
  );
}
