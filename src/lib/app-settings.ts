import { Prisma } from "@prisma/client";

import { getPrismaClient } from "@/lib/prisma";
import { ensureSchemaCompatibility } from "@/lib/schema-bootstrap";

export async function getAppSetting(key: string): Promise<string | null> {
  await ensureSchemaCompatibility();
  const rows = await getPrismaClient().$queryRaw<{ value: string | null }[]>(
    Prisma.sql`SELECT \`value\` FROM \`AppSetting\` WHERE \`settingKey\` = ${key} LIMIT 1`
  );
  return rows[0]?.value ?? null;
}

export async function setAppSetting(key: string, value: string | null): Promise<void> {
  await ensureSchemaCompatibility();
  await getPrismaClient().$executeRaw(
    Prisma.sql`INSERT INTO \`AppSetting\` (\`settingKey\`, \`value\`, \`updatedAt\`)
               VALUES (${key}, ${value}, NOW(3))
               ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), \`updatedAt\` = NOW(3)`
  );
}

export const SETTING_KEYS = {
  smartSyncIntervalHours: "smartSync.intervalHours"
} as const;
