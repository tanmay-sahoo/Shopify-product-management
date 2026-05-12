"use client";

import { useState } from "react";

import { ConnectStoreTab } from "@/components/settings/connect-store-tab";
import { CredentialsTab } from "@/components/settings/credentials-tab";
import { StoresListTab } from "@/components/settings/stores-list-tab";
import { UsersTab } from "@/components/settings/users-tab";
import type { StoreSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "stores" | "connect" | "credentials" | "users";

type Props = {
  stores: StoreSummary[];
  activeStoreId: number;
  flashStatus?: string;
  flashShop?: string;
  flashScopes?: string;
  flashMessage?: string;
};

export function SettingsTabs(props: Props) {
  const initialTab: Tab =
    props.flashStatus === "success" || props.flashStatus === "error" ? "stores" : "stores";
  const [tab, setTab] = useState<Tab>(initialTab);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "stores", label: "Stores", count: props.stores.length },
    { key: "connect", label: "Connect Store" },
    { key: "credentials", label: "App Credentials" },
    { key: "users", label: "Users" }
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-line bg-white p-2 shadow-sm">
        <div className="flex flex-wrap gap-1">
          {tabs.map((tabOption) => {
            const isActive = tab === tabOption.key;
            return (
              <button
                key={tabOption.key}
                onClick={() => setTab(tabOption.key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition",
                  isActive ? "bg-ink text-white shadow-panel" : "text-muted hover:bg-canvas"
                )}
              >
                {tabOption.label}
                {typeof tabOption.count === "number" ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                      isActive ? "bg-white/20 text-white" : "bg-slate-100 text-muted"
                    )}
                  >
                    {tabOption.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "stores" ? (
        <StoresListTab
          stores={props.stores}
          activeStoreId={props.activeStoreId}
          flashStatus={props.flashStatus}
          flashShop={props.flashShop}
          flashScopes={props.flashScopes}
          flashMessage={props.flashMessage}
          onGoToConnect={() => setTab("connect")}
        />
      ) : null}
      {tab === "connect" ? (
        <ConnectStoreTab onGoToCredentials={() => setTab("credentials")} />
      ) : null}
      {tab === "credentials" ? <CredentialsTab /> : null}
      {tab === "users" ? <UsersTab /> : null}
    </div>
  );
}
