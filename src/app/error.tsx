"use client";

import { useEffect } from "react";

// Global error boundary. Catches any uncaught error thrown while rendering a
// route segment so users never see a raw stack trace (which, for DB failures,
// would leak the database host/port). Logs the real error to the console for
// debugging.
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-16 text-ink">
      <section className="w-full max-w-md rounded-3xl border border-dashed border-rose-200 bg-rose-50/40 px-8 py-12 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <circle cx="12" cy="17" r="0.5" />
          </svg>
        </div>
        <h2 className="mt-5 text-xl font-semibold text-ink">Something went wrong</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">
          The page couldn&apos;t load. This is often a temporary connection issue — try again in a moment. Your data is
          safe; nothing was changed.
        </p>
        <button
          onClick={reset}
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow-panel hover:opacity-90"
        >
          Try again
        </button>
      </section>
    </div>
  );
}
