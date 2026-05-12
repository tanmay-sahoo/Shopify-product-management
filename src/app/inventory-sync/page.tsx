import { DashboardShell } from "@/components/dashboard-shell";
import { NoStoreConnected } from "@/components/empty-state";
import { InventorySyncBoard } from "@/components/inventory-sync/inventory-sync-board";
import { SectionHeader } from "@/components/section-header";
import { getActiveStoreIdOrThrow } from "@/lib/drafts";
import { listConnectedStores } from "@/lib/data-service";
import { listGroups } from "@/lib/inventory-sync/repo";

export default async function InventorySyncPage() {
  const stores = await listConnectedStores();
  let storeId: number | null = null;
  try {
    storeId = await getActiveStoreIdOrThrow();
  } catch {
    storeId = null;
  }
  const activeStore = storeId ? stores.find((s) => s.id === storeId) ?? null : null;
  const groups = storeId ? await listGroups(storeId) : [];

  return (
    <DashboardShell store={activeStore} stores={stores}>
      <SectionHeader
        title="Linked Inventory Sync"
        description="Link variants together so stock and price stay in sync. Mirror one source to many targets, share a stock pool across variants, or build bundles whose stock follows their components."
      />
      {storeId === null ? <NoStoreConnected /> : <InventorySyncBoard initialGroups={groups} />}
    </DashboardShell>
  );
}
