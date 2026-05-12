import { DashboardShell } from "@/components/dashboard-shell";
import { NoStoreConnected } from "@/components/empty-state";
import { SectionHeader } from "@/components/section-header";
import { VariantTable } from "@/components/variant-table";
import { getDashboardData } from "@/lib/data-service";

export default async function VariantsPage() {
  const { store, stores, variants, products } = await getDashboardData();

  return (
    <DashboardShell store={store} stores={stores}>
      <SectionHeader
        title="Variants"
        description="Focused workspace for SKU-level edits, price and inventory updates, duplicate SKU checks, and variant image assignments."
      />
      {store ? <VariantTable variants={variants} products={products} store={store} /> : <NoStoreConnected />}
    </DashboardShell>
  );
}
