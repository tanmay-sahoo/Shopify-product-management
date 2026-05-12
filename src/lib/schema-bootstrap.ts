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

  if (!(await columnExists("Store", "currencyCode"))) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `Store` ADD COLUMN `currencyCode` VARCHAR(3) NULL"
    );
    console.info("[schema-bootstrap] added Store.currencyCode column");
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

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`InventorySyncGroup\` (
      \`id\` BIGINT NOT NULL AUTO_INCREMENT,
      \`storeId\` BIGINT NOT NULL,
      \`name\` VARCHAR(255) NOT NULL,
      \`mode\` ENUM('mirror','shared_pool','bundle') NOT NULL,
      \`syncStock\` TINYINT(1) NOT NULL DEFAULT 1,
      \`syncPrice\` TINYINT(1) NOT NULL DEFAULT 0,
      \`active\` TINYINT(1) NOT NULL DEFAULT 1,
      \`lastSyncedAt\` DATETIME(3) NULL,
      \`lastError\` TEXT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`InventorySyncGroup_storeId_idx\` (\`storeId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`ProductMetafield\` (
      \`id\` BIGINT NOT NULL AUTO_INCREMENT,
      \`storeId\` BIGINT NOT NULL,
      \`productId\` BIGINT NOT NULL,
      \`shopifyMetafieldId\` VARCHAR(255) NULL,
      \`namespace\` VARCHAR(255) NOT NULL,
      \`metafieldKey\` VARCHAR(255) NOT NULL,
      \`type\` VARCHAR(255) NOT NULL,
      \`value\` MEDIUMTEXT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`ProductMetafield_productId_idx\` (\`productId\`),
      INDEX \`ProductMetafield_storeId_idx\` (\`storeId\`),
      UNIQUE INDEX \`ProductMetafield_productId_namespace_key_unique\` (\`productId\`, \`namespace\`, \`metafieldKey\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`VariantMetafield\` (
      \`id\` BIGINT NOT NULL AUTO_INCREMENT,
      \`storeId\` BIGINT NOT NULL,
      \`variantId\` BIGINT NOT NULL,
      \`shopifyMetafieldId\` VARCHAR(255) NULL,
      \`namespace\` VARCHAR(255) NOT NULL,
      \`metafieldKey\` VARCHAR(255) NOT NULL,
      \`type\` VARCHAR(255) NOT NULL,
      \`value\` MEDIUMTEXT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`VariantMetafield_variantId_idx\` (\`variantId\`),
      INDEX \`VariantMetafield_storeId_idx\` (\`storeId\`),
      UNIQUE INDEX \`VariantMetafield_variantId_namespace_key_unique\` (\`variantId\`, \`namespace\`, \`metafieldKey\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`InventorySyncGroupItem\` (
      \`id\` BIGINT NOT NULL AUTO_INCREMENT,
      \`groupId\` BIGINT NOT NULL,
      \`storeId\` BIGINT NOT NULL,
      \`productId\` BIGINT NULL,
      \`variantId\` BIGINT NULL,
      \`shopifyProductId\` VARCHAR(255) NULL,
      \`shopifyVariantId\` VARCHAR(255) NOT NULL,
      \`inventoryItemId\` VARCHAR(255) NULL,
      \`locationId\` VARCHAR(255) NULL,
      \`role\` ENUM('source','target','component','combo','member') NOT NULL,
      \`quantityRequired\` INT NOT NULL DEFAULT 1,
      \`stockBuffer\` INT NOT NULL DEFAULT 0,
      \`priceMultiplier\` DECIMAL(12,4) NOT NULL DEFAULT 1,
      \`syncStock\` TINYINT(1) NOT NULL DEFAULT 1,
      \`syncPrice\` TINYINT(1) NOT NULL DEFAULT 0,
      \`active\` TINYINT(1) NOT NULL DEFAULT 1,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`InventorySyncGroupItem_groupId_idx\` (\`groupId\`),
      INDEX \`InventorySyncGroupItem_storeId_idx\` (\`storeId\`),
      INDEX \`InventorySyncGroupItem_shopifyVariantId_idx\` (\`shopifyVariantId\`),
      INDEX \`InventorySyncGroupItem_inventoryItemId_idx\` (\`inventoryItemId\`),
      CONSTRAINT \`InventorySyncGroupItem_groupId_fkey\` FOREIGN KEY (\`groupId\`)
        REFERENCES \`InventorySyncGroup\` (\`id\`) ON DELETE CASCADE
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
