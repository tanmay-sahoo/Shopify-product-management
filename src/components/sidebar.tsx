"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type NavItem<T extends string = string> = {
  label: string;
  href: Route<T>;
  icon: ReactNode;
};

const iconClass = "h-[18px] w-[18px]";

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    )
  },
  {
    label: "Products",
    href: "/products",
    icon: (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7l9-4 9 4" />
        <path d="M3 7v10l9 4 9-4V7" />
        <path d="M3 7l9 4 9-4" />
        <path d="M12 11v10" />
      </svg>
    )
  },
  {
    label: "Collections",
    href: "/collections",
    icon: (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    )
  },
  {
    label: "Bulk Import",
    href: "/imports",
    icon: (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    )
  },
  {
    label: "Inventory Sync",
    href: "/inventory-sync",
    icon: (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h6v6H4z" />
        <path d="M14 14h6v6h-6z" />
        <path d="M14 4l6 6" />
        <path d="M10 14l-6 6" />
      </svg>
    )
  },
  {
    label: "Drafts",
    href: "/drafts",
    icon: (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    )
  },
  {
    label: "Sync Logs",
    href: "/logs",
    icon: (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    )
  },
  {
    label: "Settings",
    href: "/settings",
    icon: (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    )
  }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-72 flex-col border-r border-line/40 bg-[#0b1220] px-5 py-6 text-white">
      <div className="flex items-center gap-3 px-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-indigo-500 shadow-lg shadow-brand/30">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M3 7l9-4 9 4-9 4-9-4z" />
            <path d="M3 12l9 4 9-4" />
            <path d="M3 17l9 4 9-4" />
          </svg>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">Shopify</p>
          <h1 className="text-base font-semibold text-white">Product Manager</h1>
        </div>
      </div>

      <nav className="mt-8 space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                active
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg transition",
                  active ? "bg-brand text-white" : "bg-white/5 text-slate-300 group-hover:bg-white/10"
                )}
              >
                {item.icon}
              </span>
              <span>{item.label}</span>
              {active ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand" /> : null}
            </Link>
          );
        })}
      </nav>

      <UserCard />
    </aside>
  );
}

type Me = {
  name: string | null;
  email: string | null;
  role: string;
  source: "env" | "db" | "session";
};

function UserCard() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : { user: null }))
      .then((body) => {
        if (cancelled) return;
        setMe(body?.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const displayName = me?.name?.trim() || me?.email || "Account";
  const subtitle = me?.email && me.name ? me.email : me?.role ?? "";
  const initials = (me?.name ?? me?.email ?? "U")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-sm font-bold">
          {loading ? "·" : initials || "U"}
        </div>
        <div className="min-w-0 flex-1">
          {loading ? (
            <>
              <div className="h-3 w-24 rounded bg-white/10" />
              <div className="mt-2 h-2.5 w-32 rounded bg-white/10" />
            </>
          ) : (
            <>
              <p className="truncate text-sm font-semibold text-white">{displayName}</p>
              <div className="flex items-center gap-1.5">
                <p className="truncate text-xs text-slate-400">{subtitle}</p>
                {me?.source === "env" ? (
                  <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300">
                    env
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>
        <SignOutButton />
      </div>
    </div>
  );
}

function SignOutButton() {
  async function handleSignOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }
  return (
    <button
      onClick={handleSignOut}
      title="Sign out"
      aria-label="Sign out"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
    </button>
  );
}
