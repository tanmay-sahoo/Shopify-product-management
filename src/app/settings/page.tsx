import { DashboardShell } from "@/components/dashboard-shell";
import { DatabaseUnreachable } from "@/components/empty-state";
import { SectionHeader } from "@/components/section-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { getDashboardData } from "@/lib/data-service";

type SettingsPageProps = {
  searchParams?: Promise<{
    status?: string;
    message?: string;
    shop?: string;
    scopes?: string;
  }>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const { store, stores, dbError } = await getDashboardData();
  const params = await searchParams;

  return (
    <DashboardShell store={store} stores={stores}>
      <SectionHeader
        title="Settings"
        description="Manage connected stores, saved Shopify app credentials, and dashboard users."
      />
      {dbError ? (
        <DatabaseUnreachable />
      ) : (
        <SettingsTabs
          stores={stores}
          activeStoreId={store?.id ?? 0}
          flashStatus={params?.status}
          flashShop={params?.shop}
          flashScopes={params?.scopes}
          flashMessage={params?.message}
        />
      )}
    </DashboardShell>
  );
}
