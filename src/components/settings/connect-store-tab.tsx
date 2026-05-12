"use client";

import { useEffect, useState } from "react";

type SavedCredential = { id: number; name: string; clientId: string };

type Props = {
  onGoToCredentials: () => void;
};

export function ConnectStoreTab({ onGoToCredentials }: Props) {
  const [credentials, setCredentials] = useState<SavedCredential[]>([]);
  const [selectedCred, setSelectedCred] = useState<string>("");
  const [redirectUri, setRedirectUri] = useState("/api/auth/shopify/callback");

  useEffect(() => {
    fetch("/api/credentials")
      .then((r) => r.json())
      .then((body) => setCredentials(Array.isArray(body?.items) ? body.items : []))
      .catch(() => setCredentials([]));
    if (typeof window !== "undefined") {
      setRedirectUri(`${window.location.origin}/api/auth/shopify/callback`);
    }
  }, []);

  return (
    <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
      <article className="rounded-3xl border border-line bg-white p-6 shadow-sm">
        <h4 className="text-base font-semibold text-ink">Connect a new Shopify store</h4>
        <p className="mt-1 text-sm leading-6 text-muted">
          Give it a name, paste the shop URL, then either pick a saved app credential or enter a fresh one.
        </p>

        <form action="/api/auth/shopify/start" method="post" className="mt-6 space-y-4">
          <Field label="Store name" hint="Optional · shows in the sidebar switcher">
            <input
              name="displayName"
              placeholder="e.g. Brand A · EU production"
              className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
            />
          </Field>

          <Field label="Shop URL" hint="*.myshopify.com">
            <input
              name="shop"
              required
              placeholder="client-store.myshopify.com"
              className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
            />
          </Field>

          <Field
            label="Use saved app credentials"
            hint={
              credentials.length === 0
                ? "Add one in the App Credentials tab"
                : `${credentials.length} saved`
            }
          >
            {credentials.length === 0 ? (
              <button
                type="button"
                onClick={onGoToCredentials}
                className="w-full rounded-2xl border border-dashed border-line bg-canvas px-4 py-3 text-left text-sm text-muted hover:bg-white"
              >
                No saved credentials. <span className="font-semibold text-brand">Add one →</span>
              </button>
            ) : (
              <select
                name="credentialId"
                value={selectedCred}
                onChange={(event) => setSelectedCred(event.target.value)}
                className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
              >
                <option value="">— Enter new credentials below —</option>
                {credentials.map((cred) => (
                  <option key={cred.id} value={cred.id}>
                    {cred.name} · {cred.clientId.slice(0, 8)}…
                  </option>
                ))}
              </select>
            )}
          </Field>

          {!selectedCred ? (
            <>
              <Field label="Shopify Client ID">
                <input
                  name="clientId"
                  placeholder="e.g. 1234567890abcdef…"
                  className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
                />
              </Field>
              <Field label="Shopify Client Secret">
                <input
                  name="clientSecret"
                  type="password"
                  placeholder="Encrypted in DB after submit"
                  className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none focus:border-brand focus:bg-white"
                />
              </Field>
            </>
          ) : (
            <p className="rounded-2xl bg-canvas px-4 py-3 text-xs text-muted">
              Using saved credential:{" "}
              <span className="font-semibold text-ink">
                {credentials.find((cred) => String(cred.id) === selectedCred)?.name}
              </span>
            </p>
          )}

          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-panel transition hover:opacity-90"
          >
            Continue to Shopify
          </button>
        </form>
      </article>

      <article className="rounded-3xl border border-line bg-white p-6 shadow-sm">
        <h4 className="text-base font-semibold text-ink">OAuth flow</h4>
        <ol className="mt-4 space-y-3 text-sm leading-6 text-muted">
          <li>
            <span className="font-semibold text-ink">1.</span> Submit shop URL + credentials. Secret is AES-256-CBC
            encrypted with <code className="font-mono text-xs">TOKEN_ENCRYPTION_KEY</code>.
          </li>
          <li>
            <span className="font-semibold text-ink">2.</span> Redirect to Shopify, approve scopes.
          </li>
          <li>
            <span className="font-semibold text-ink">3.</span> Shopify calls back, HMAC + state verified.
          </li>
          <li>
            <span className="font-semibold text-ink">4.</span> Code exchanged for an access token; persisted encrypted.
          </li>
        </ol>
        <div className="mt-5 rounded-2xl border border-dashed border-line bg-canvas px-4 py-3 text-xs leading-5 text-muted">
          <p className="font-semibold text-ink/80">Redirect URI for this environment</p>
          <p className="mt-1 break-all font-mono text-[11px] text-ink">{redirectUri}</p>
          <p className="mt-2">Add this URL to your Shopify app's Allowed redirection URLs.</p>
        </div>
      </article>
    </div>
  );
}

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">{label}</span>
        {hint ? <span className="text-[10px] text-muted">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}
