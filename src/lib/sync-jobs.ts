import { Prisma } from "@prisma/client";

import { getPrismaClient } from "@/lib/prisma";
import { ensureSchemaCompatibility } from "@/lib/schema-bootstrap";
import { syncStoreCatalog, type SyncProgress } from "@/lib/shopify-sync";

export type SyncJobStatus = "queued" | "running" | "success" | "failed";

export type SyncJobRow = {
  id: string;
  storeId: string;
  status: SyncJobStatus;
  phase: string;
  currentCount: number;
  totalCount: number | null;
  message: string | null;
  startedAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
};

type RawJobRow = {
  id: bigint;
  storeId: bigint;
  status: SyncJobStatus;
  phase: string;
  currentCount: number;
  totalCount: number | null;
  message: string | null;
  startedAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
};

function toApiRow(row: RawJobRow): SyncJobRow {
  return {
    id: row.id.toString(),
    storeId: row.storeId.toString(),
    status: row.status,
    phase: row.phase,
    currentCount: Number(row.currentCount),
    totalCount: row.totalCount === null || row.totalCount === undefined ? null : Number(row.totalCount),
    message: row.message,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt
  };
}

async function insertJob(storeId: bigint): Promise<bigint> {
  const db = getPrismaClient();
  await db.$executeRaw(
    Prisma.sql`INSERT INTO \`SyncJob\` (storeId, status, phase, currentCount, totalCount, message, startedAt, updatedAt)
               VALUES (${storeId}, 'queued', 'pending', 0, NULL, 'Queued', NOW(3), NOW(3))`
  );
  const rows = await db.$queryRaw<{ id: bigint }[]>(
    Prisma.sql`SELECT \`id\` FROM \`SyncJob\` WHERE storeId = ${storeId} ORDER BY id DESC LIMIT 1`
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Failed to create sync job");
  return id;
}

async function updateJob(
  jobId: bigint,
  patch: { status?: SyncJobStatus; phase?: string; current?: number; total?: number | null; message?: string; finished?: boolean }
) {
  const db = getPrismaClient();
  const sets: Prisma.Sql[] = [];
  if (patch.status !== undefined) sets.push(Prisma.sql`\`status\` = ${patch.status}`);
  if (patch.phase !== undefined) sets.push(Prisma.sql`\`phase\` = ${patch.phase}`);
  if (patch.current !== undefined) sets.push(Prisma.sql`\`currentCount\` = ${patch.current}`);
  if (patch.total !== undefined) sets.push(Prisma.sql`\`totalCount\` = ${patch.total}`);
  if (patch.message !== undefined) sets.push(Prisma.sql`\`message\` = ${patch.message}`);
  if (patch.finished) sets.push(Prisma.sql`\`finishedAt\` = NOW(3)`);
  sets.push(Prisma.sql`\`updatedAt\` = NOW(3)`);
  const setClause = Prisma.join(sets, ", ");
  await db.$executeRaw(Prisma.sql`UPDATE \`SyncJob\` SET ${setClause} WHERE \`id\` = ${jobId}`);
}

// A sync job is treated as dead if its updatedAt heartbeat hasn't moved in
// this many ms. Covers cases where the dev server restarted mid-sync or the
// worker process crashed silently, leaving a row stuck in "running".
const STALE_HEARTBEAT_MS = 90_000;

// Mark any "queued"/"running" rows for this store as failed if their heartbeat
// is older than the threshold. Run before every status check so the UI never
// stares at a corpse forever.
async function reapStaleJobs(storeId: bigint) {
  const db = getPrismaClient();
  await db.$executeRaw(
    Prisma.sql`UPDATE \`SyncJob\`
               SET \`status\` = 'failed',
                   \`message\` = COALESCE(NULLIF(\`message\`,''), 'Sync did not complete (worker stopped)'),
                   \`finishedAt\` = NOW(3),
                   \`updatedAt\` = NOW(3)
               WHERE storeId = ${storeId}
                 AND status IN ('queued','running')
                 AND updatedAt < (NOW(3) - INTERVAL ${STALE_HEARTBEAT_MS / 1000} SECOND)`
  );
}

export async function getLatestSyncJob(storeId: bigint): Promise<SyncJobRow | null> {
  await ensureSchemaCompatibility();
  await reapStaleJobs(storeId);
  const db = getPrismaClient();
  const rows = await db.$queryRaw<RawJobRow[]>(
    Prisma.sql`SELECT id, storeId, status, phase, currentCount, totalCount, message, startedAt, updatedAt, finishedAt
               FROM \`SyncJob\` WHERE storeId = ${storeId} ORDER BY id DESC LIMIT 1`
  );
  if (!rows[0]) return null;
  return toApiRow(rows[0]);
}

export async function hasRunningSyncJob(storeId: bigint): Promise<boolean> {
  await reapStaleJobs(storeId);
  const db = getPrismaClient();
  const rows = await db.$queryRaw<{ count: bigint }[]>(
    Prisma.sql`SELECT COUNT(*) AS count FROM \`SyncJob\`
               WHERE storeId = ${storeId} AND status IN ('queued','running')`
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

// Manually mark every in-progress job for this store as cancelled. Used when
// the user explicitly hits a "Cancel sync" button to unstick the UI.
export async function cancelRunningSyncJobs(storeId: bigint): Promise<number> {
  await ensureSchemaCompatibility();
  const db = getPrismaClient();
  const result = await db.$executeRaw(
    Prisma.sql`UPDATE \`SyncJob\`
               SET \`status\` = 'failed',
                   \`message\` = 'Cancelled by user',
                   \`finishedAt\` = NOW(3),
                   \`updatedAt\` = NOW(3)
               WHERE storeId = ${storeId}
                 AND status IN ('queued','running')`
  );
  return Number(result);
}

// Kick off a sync in the background and return the SyncJob row immediately.
// The sync continues running in this Node process — fine for single-process
// deployments. For serverless, swap this for a real queue.
export async function startSyncJob(storeId: bigint): Promise<SyncJobRow> {
  await ensureSchemaCompatibility();
  const jobId = await insertJob(storeId);

  // Fire-and-forget — never await this in the request path.
  setImmediate(async () => {
    // Heartbeat ticker: bumps SyncJob.updatedAt every 20s so the stale-reaper
    // doesn't kill a long-but-healthy sync.
    const heartbeat = setInterval(() => {
      void updateJob(jobId, {}).catch(() => {});
    }, 20_000);

    try {
      await updateJob(jobId, { status: "running", phase: "fetching", message: "Starting sync…" });
      const onProgress = async (p: SyncProgress) => {
        await updateJob(jobId, {
          phase: p.phase,
          current: p.current,
          total: p.total,
          message: p.message
        });
      };
      const result = await syncStoreCatalog(storeId, { onProgress });
      await updateJob(jobId, {
        status: "success",
        phase: "done",
        current: result.syncedProducts,
        total: result.syncedProducts,
        message: `Synced ${result.syncedProducts} products, ${result.syncedVariants} variants.`,
        finished: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed";
      try {
        await updateJob(jobId, { status: "failed", message, finished: true });
      } catch {
        // best-effort
      }
      console.error("[sync-job] failed:", error);
    } finally {
      clearInterval(heartbeat);
    }
  });

  const row = await getLatestSyncJob(storeId);
  if (!row) throw new Error("Sync job not visible after insert");
  return row;
}
