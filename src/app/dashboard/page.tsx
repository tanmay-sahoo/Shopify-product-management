import { DashboardShell } from "@/components/dashboard-shell";
import { NoStoreConnected } from "@/components/empty-state";
import { SectionHeader } from "@/components/section-header";
import { StatCard } from "@/components/stat-card";
import { ProductTable } from "@/components/product-table";
import { getDashboardData } from "@/lib/data-service";
import { formatDate } from "@/lib/utils";

const iconClass = "h-[18px] w-[18px]";

const icons = {
  product: (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 7v10l9 4 9-4V7" />
      <path d="M12 11v10" />
    </svg>
  ),
  variants: (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="19" r="2" />
      <path d="M12 7v3M12 10l-6 7M12 10l6 7" />
    </svg>
  ),
  draft: (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  alert: (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <circle cx="12" cy="17" r="0.5" />
    </svg>
  ),
  image: (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M21 17l-5-5-7 7" />
    </svg>
  ),
  clock: (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
};

const statusTone: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-700",
  partial: "bg-amber-100 text-amber-700",
  failed: "bg-rose-100 text-rose-700",
  started: "bg-slate-100 text-slate-700"
};

export default async function DashboardPage() {
  const { stats, products, store, stores, syncLogs } = await getDashboardData();

  if (!store) {
    return (
      <DashboardShell store={null} stores={stores}>
        <SectionHeader
          title="Overview"
          description="Stage product edits safely, validate bulk changes, and review activity before pushing to Shopify."
        />
        <NoStoreConnected />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell store={store} stores={stores}>
      <SectionHeader
        title="Overview"
        description="Stage product edits safely, validate bulk changes, and review activity before pushing to Shopify."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Total Products"
          value={stats.totalProducts}
          helper="Active catalog items synced from Shopify."
          tone="info"
          icon={icons.product}
        />
        <StatCard
          label="Total Variants"
          value={stats.totalVariants}
          helper="Variant records currently available."
          tone="info"
          icon={icons.variants}
        />
        <StatCard
          label="Draft Changes"
          value={stats.draftChanges}
          helper="Changes waiting for approval or push."
          tone="warning"
          icon={icons.draft}
        />
        <StatCard
          label="Import Errors"
          value={stats.importErrors}
          helper="Rows blocked during validation."
          tone="danger"
          icon={icons.alert}
        />
        <StatCard
          label="Images Pending"
          value={stats.imagesPending}
          helper="Media links waiting for upload or mapping."
          tone="success"
          icon={icons.image}
        />
        <StatCard
          label="Last Sync"
          value={formatDate(stats.lastSyncAt)}
          helper="Most recent sync completion timestamp."
          icon={icons.clock}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <div className="space-y-4">
          <SectionHeader
            title="Products"
            description="Search, filter, expand variants, and stage bulk actions."
          />
          <ProductTable products={products} store={store} />
        </div>

        <div className="space-y-4">
          <SectionHeader title="Recent Activity" description="Latest sync and import operations." />
          <div className="space-y-3">
            {syncLogs.map((log) => (
              <article
                key={log.id}
                className="rounded-2xl border border-line/70 bg-white p-4 shadow-sm transition hover:shadow-panel"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                    {log.jobType}
                  </p>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                      statusTone[log.status] ?? statusTone.started
                    }`}
                  >
                    {log.status}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-ink/80">{log.message}</p>
                <p className="mt-2 text-[11px] text-muted">{formatDate(log.createdAt)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </DashboardShell>
  );
}
