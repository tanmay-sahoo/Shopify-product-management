import { CollectionTable } from "@/components/collection-table";
import { DashboardShell } from "@/components/dashboard-shell";
import { DatabaseUnreachable, NoStoreConnected } from "@/components/empty-state";
import { SectionHeader } from "@/components/section-header";
import { getCollectionsData } from "@/lib/collections-service";

export default async function CollectionsPage() {
  const { collections, store, stores, dbError } = await getCollectionsData();

  return (
    <DashboardShell store={store} stores={stores}>
      <SectionHeader
        title="Collections"
        description="View synced collections (custom and smart), their details, and custom metafields. To bulk-edit collections, use the Bulk Import section (Collections tab). Smart-collection rules are shown but never modified."
      />
      {dbError ? (
        <DatabaseUnreachable />
      ) : store ? (
        <CollectionTable collections={collections} store={store} />
      ) : (
        <NoStoreConnected />
      )}
    </DashboardShell>
  );
}
