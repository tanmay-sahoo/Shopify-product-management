"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const POLL_INTERVAL_MS = 15_000;

export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let lastRefresh = Date.now();

    function refresh() {
      lastRefresh = Date.now();
      router.refresh();
    }

    function onTick() {
      if (typeof document === "undefined" || document.visibilityState !== "visible") return;
      refresh();
    }

    function onFocus() {
      if (Date.now() - lastRefresh < 1000) return;
      refresh();
    }

    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefresh < 1000) return;
      refresh();
    }

    intervalId = setInterval(onTick, POLL_INTERVAL_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}
