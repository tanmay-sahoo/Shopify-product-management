import { Suspense } from "react";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f8fc] px-4 py-12">
      <section className="w-full max-w-md rounded-3xl border border-line bg-white p-8 shadow-panel sm:p-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-indigo-500 shadow-lg shadow-brand/30">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M3 7l9-4 9 4-9 4-9-4z" />
              <path d="M3 12l9 4 9-4" />
              <path d="M3 17l9 4 9-4" />
            </svg>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted">Shopify</p>
            <h2 className="text-base font-semibold text-ink">Product Manager</h2>
          </div>
        </div>

        <div className="mt-8">
          <h1 className="text-2xl font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Enter your credentials to continue.</p>
        </div>

        <Suspense
          fallback={<div className="mt-6 h-40 rounded-2xl border border-line bg-canvas" aria-hidden />}
        >
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
