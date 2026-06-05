import { DashboardShell } from "@/components/dashboard-shell";
import { DatabaseUnreachable, NoStoreConnected } from "@/components/empty-state";
import { ProductTable } from "@/components/product-table";
import { SectionHeader } from "@/components/section-header";
import { getDashboardData } from "@/lib/data-service";

export default async function ProductsPage() {
  const { products, store, stores, dbError } = await getDashboardData();

  return (
    <DashboardShell store={store} stores={stores}>
      <SectionHeader
        title="Products"
        description="Excel-like product management view with search, filters, bulk selection, draft-safe staging, and export entry points."
      />
      {dbError ? (
        <DatabaseUnreachable />
      ) : store ? (
        <ProductTable products={products} store={store} />
      ) : (
        <NoStoreConnected />
      )}
    </DashboardShell>
  );
}
