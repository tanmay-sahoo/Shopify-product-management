"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { StoreSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  current: StoreSummary;
  stores: StoreSummary[];
};

export function StoreSwitcher({ current, stores }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function selectStore(id: number) {
    if (id === current.id) {
      setOpen(false);
      return;
    }
    setBusyId(id);
    try {
      const response = await fetch("/api/stores/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      if (!response.ok) return;
      setOpen(false);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-3 rounded-2xl border border-line bg-white px-3 py-2 text-left transition hover:border-brand/40"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brandSoft text-brand">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M19 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
            <path d="M16 7V5a4 4 0 0 0-8 0v2" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">Active store</p>
          <p className="truncate text-sm font-semibold text-ink">{current.displayName ?? current.shopDomain}</p>
          {current.displayName ? (
            <p className="truncate text-[10px] text-muted">{current.shopDomain}</p>
          ) : null}
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={cn("ml-1 h-4 w-4 text-muted transition", open && "rotate-180")}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open ? (
        <div className="absolute left-0 z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-line bg-white shadow-panel">
          <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
            {stores.length} connected store{stores.length === 1 ? "" : "s"}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {stores.map((store) => {
              const isActive = store.id === current.id;
              const isDisabled = store.status !== "active";
              return (
                <li key={store.id}>
                  <button
                    onClick={() => selectStore(store.id)}
                    disabled={isDisabled || busyId === store.id}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition",
                      isActive ? "bg-brandSoft/60" : "hover:bg-slate-50",
                      isDisabled && "cursor-not-allowed opacity-60"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold",
                        isActive ? "bg-brand text-white" : "bg-slate-100 text-slate-600"
                      )}
                    >
                      {(store.displayName ?? store.shopDomain).charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">
                        {store.displayName ?? store.shopDomain}
                      </p>
                      <p className="truncate text-[11px] text-muted">
                        {store.displayName ? store.shopDomain : `${store.status} · ${store.scopes.length} scopes`}
                      </p>
                    </div>
                    {busyId === store.id ? (
                      <span className="text-xs text-muted">Switching…</span>
                    ) : isActive ? (
                      <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                        Active
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <a
            href="/settings"
            className="flex items-center gap-2 border-t border-line bg-canvas px-4 py-3 text-sm font-semibold text-brand hover:bg-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Connect new store
          </a>
        </div>
      ) : null}
    </div>
  );
}
