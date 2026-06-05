import Link from "next/link";

export function DatabaseUnreachable() {
  return (
    <section className="rounded-3xl border border-dashed border-rose-200 bg-rose-50/40 px-8 py-16 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v14a9 3 0 0 0 18 0V5" />
          <line x1="3" y1="5" x2="21" y2="19" />
        </svg>
      </div>
      <h2 className="mt-5 text-xl font-semibold text-ink">Can&apos;t reach the database</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
        The app couldn&apos;t connect to its database server. This is usually temporary — check that the database is
        running and reachable, then reload. Your data is safe; nothing was changed.
      </p>
    </section>
  );
}

export function NoStoreConnected() {
  return (
    <section className="rounded-3xl border border-dashed border-line bg-white px-8 py-16 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brandSoft text-brand">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M19 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
          <path d="M16 7V5a4 4 0 0 0-8 0v2" />
        </svg>
      </div>
      <h2 className="mt-5 text-xl font-semibold text-ink">No Shopify store connected yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
        Connect a Shopify store to load your real products, variants, drafts, and sync logs. Until then, the
        dashboard sections are empty.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 rounded-2xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow-panel hover:opacity-90"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Connect a store
        </Link>
      </div>
    </section>
  );
}
