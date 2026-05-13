// Server-side smart-sync scheduler. One in-process timer; runs as long as the
// Node server is alive. For each tick:
//   1. Read AppSetting.smartSync.intervalHours.
//   2. Find every connected store whose lastSyncAt is older than the threshold.
//   3. Enqueue a background sync for each one via startSyncJob.
//
// Safe to run alongside multiple instances or browser-side triggers because
// startSyncJob short-circuits via hasRunningSyncJob.
//
// Caveats:
//   - Dies if the Node process dies. In dev (next dev), hot-reload may restart
//     it; in prod (next start) it persists until the server stops.
//   - In serverless (Vercel), this won't run — that environment needs a real
//     cron job (e.g. Vercel Cron) hitting an HTTP endpoint instead. The exposed
//     /api/cron/smart-sync route is provided for that case.

import { getPrismaClient } from "@/lib/prisma";
import { getAppSetting, SETTING_KEYS } from "@/lib/app-settings";
import { ensureSchemaCompatibility } from "@/lib/schema-bootstrap";
import { hasRunningSyncJob, startSyncJob } from "@/lib/sync-jobs";

const TICK_INTERVAL_MS = 5 * 60 * 1000; // re-evaluate every 5 minutes
const STARTUP_DELAY_MS = 30_000; // wait 30s after server start before first tick

declare global {
  // eslint-disable-next-line no-var
  var __smartSyncSchedulerStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var __smartSyncSchedulerHandle: ReturnType<typeof setInterval> | undefined;
}

export async function runSmartSyncTick(): Promise<{ triggered: number; checked: number; intervalHours: number }> {
  await ensureSchemaCompatibility();
  const raw = await getAppSetting(SETTING_KEYS.smartSyncIntervalHours);
  const intervalHours = raw === null ? 0 : Number(raw);
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
    return { triggered: 0, checked: 0, intervalHours: 0 };
  }
  const thresholdMs = intervalHours * 60 * 60 * 1000;

  const db = getPrismaClient();
  const stores = await db.store.findMany({
    where: { status: { not: "uninstalled" } },
    select: { id: true, lastSyncAt: true }
  });

  let triggered = 0;
  for (const store of stores) {
    const lastSyncMs = store.lastSyncAt ? store.lastSyncAt.getTime() : 0;
    if (lastSyncMs > 0 && Date.now() - lastSyncMs < thresholdMs) continue;
    if (await hasRunningSyncJob(store.id)) continue;
    try {
      await startSyncJob(store.id);
      triggered += 1;
    } catch (error) {
      console.error("[smart-sync-scheduler] failed to start sync for store", String(store.id), error);
    }
  }
  return { triggered, checked: stores.length, intervalHours };
}

export function ensureSmartSyncScheduler() {
  // Module is imported in many places (API routes, the instrumentation hook).
  // Use a global flag so only one timer ever runs per Node process, even
  // across hot reloads in dev.
  if (globalThis.__smartSyncSchedulerStarted) return;
  globalThis.__smartSyncSchedulerStarted = true;

  setTimeout(() => {
    void runSmartSyncTick().catch((error) => {
      console.error("[smart-sync-scheduler] initial tick failed", error);
    });
  }, STARTUP_DELAY_MS);

  globalThis.__smartSyncSchedulerHandle = setInterval(() => {
    void runSmartSyncTick().catch((error) => {
      console.error("[smart-sync-scheduler] tick failed", error);
    });
  }, TICK_INTERVAL_MS);

  console.info(`[smart-sync-scheduler] started (tick every ${TICK_INTERVAL_MS / 60_000} min)`);
}
