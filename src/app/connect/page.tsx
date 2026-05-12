type ConnectPageProps = {
  searchParams?: Promise<{
    status?: string;
    message?: string;
    shop?: string;
    scopes?: string;
    token?: string;
  }>;
};

export default async function ConnectPage({ searchParams }: ConnectPageProps) {
  const params = await searchParams;
  const status = params?.status;
  const shop = params?.shop;
  const scopes = params?.scopes;
  const tokenPreview = params?.token;
  const errorMessage = params?.message;

  return (
    <main className="min-h-screen bg-canvas px-6 py-16">
      <div className="mx-auto max-w-2xl rounded-[2rem] border border-line bg-panel p-8 shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-muted">Connect Shopify Store</p>
        <h1 className="mt-4 text-3xl font-semibold text-ink">Install the dashboard into a client store</h1>
        <p className="mt-4 text-sm leading-7 text-muted">
          Enter Shopify app credentials and the shop URL. After you click connect, the app redirects to Shopify OAuth,
          verifies callback security, and automatically exchanges the code for an Admin API token.
        </p>

        {status === "success" ? (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="font-semibold">Store authenticated successfully.</p>
            <p className="mt-2">Shop: {shop}</p>
            <p className="mt-1">Scopes: {scopes}</p>
            <p className="mt-1">Encrypted token preview: {tokenPreview}</p>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <p className="font-semibold">Authentication failed.</p>
            <p className="mt-2">Reason: {errorMessage ?? "unknown_error"}</p>
          </div>
        ) : null}

        <form action="/api/auth/shopify/start" method="post" className="mt-8 space-y-4">
          <label className="block text-sm font-medium text-ink" htmlFor="clientId">
            Shopify Client ID
          </label>
          <input
            id="clientId"
            name="clientId"
            placeholder="e.g. 1234567890abcdef"
            required
            className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 outline-none"
          />
          <label className="block text-sm font-medium text-ink" htmlFor="clientSecret">
            Shopify Client Secret
          </label>
          <input
            id="clientSecret"
            name="clientSecret"
            type="password"
            placeholder="Enter app secret"
            required
            className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 outline-none"
          />
          <label className="block text-sm font-medium text-ink" htmlFor="shop">
            Shopify store URL
          </label>
          <input
            id="shop"
            name="shop"
            placeholder="client-store.myshopify.com"
            required
            className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 outline-none"
          />
          <button className="rounded-2xl bg-brand px-5 py-3 text-sm font-semibold text-white">Connect store</button>
        </form>
      </div>
    </main>
  );
}
