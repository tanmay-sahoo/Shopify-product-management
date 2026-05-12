import { Prisma } from "@prisma/client";

import { getPrismaClient } from "@/lib/prisma";

let bootstrapPromise: Promise<void> | null = null;

async function columnExists(table: string, column: string) {
  const rows = await getPrismaClient().$queryRaw<{ count: bigint }[]>(
    Prisma.sql`SELECT COUNT(*) AS count
               FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE()
                 AND TABLE_NAME = ${table}
                 AND COLUMN_NAME = ${column}`
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function bootstrap() {
  const prisma = getPrismaClient();

  if (!(await columnExists("Store", "displayName"))) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `Store` ADD COLUMN `displayName` VARCHAR(255) NULL"
    );
    console.info("[schema-bootstrap] added Store.displayName column");
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`ShopifyAppCredential\` (
      \`id\` BIGINT NOT NULL AUTO_INCREMENT,
      \`name\` VARCHAR(255) NOT NULL,
      \`clientId\` VARCHAR(255) NOT NULL,
      \`clientSecretEncrypted\` TEXT NOT NULL,
      \`notes\` TEXT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`ShopifyAppCredential_clientId_key\` (\`clientId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

export function ensureSchemaCompatibility(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap().catch((error) => {
      console.error("[schema-bootstrap] failed:", error);
      bootstrapPromise = null;
      throw error;
    });
  }
  return bootstrapPromise;
}
