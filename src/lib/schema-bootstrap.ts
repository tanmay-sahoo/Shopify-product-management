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

async function indexExists(table: string, indexName: string) {
  const rows = await getPrismaClient().$queryRaw<{ count: bigint }[]>(
    Prisma.sql`SELECT COUNT(*) AS count
               FROM INFORMATION_SCHEMA.STATISTICS
               WHERE TABLE_SCHEMA = DATABASE()
                 AND TABLE_NAME = ${table}
                 AND INDEX_NAME = ${indexName}`
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

  // Extend the Import.importType enum with 'collections' if missing. Guarded so
  // we only run the (table-locking) MODIFY when the value isn't already present.
  {
    const rows = await getPrismaClient().$queryRaw<{ COLUMN_TYPE: string }[]>(
      Prisma.sql`SELECT COLUMN_TYPE
                 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'Import'
                   AND COLUMN_NAME = 'importType'`
    );
    const columnType = rows[0]?.COLUMN_TYPE ?? "";
    if (columnType && !columnType.includes("collections")) {
      await prisma.$executeRawUnsafe(
        "ALTER TABLE `Import` MODIFY `importType` ENUM('products','variants','prices','inventory','images','collections') NOT NULL DEFAULT 'products'"
      );
      console.info("[schema-bootstrap] added 'collections' to Import.importType enum");
    }
  }

  // Import-job progress columns. Plain VARCHAR/INT to keep migrations cheap.
  if (!(await columnExists("Import", "phase"))) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `Import` ADD COLUMN `phase` VARCHAR(50) NOT NULL DEFAULT 'pending'"
    );
  }
  if (!(await columnExists("Import", "currentCount"))) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `Import` ADD COLUMN `currentCount` INT NOT NULL DEFAULT 0"
    );
  }
  if (!(await columnExists("Import", "message"))) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `Import` ADD COLUMN `message` TEXT NULL"
    );
  }
  if (!(await columnExists("Import", "finishedAt"))) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `Import` ADD COLUMN `finishedAt` DATETIME(3) NULL"
    );
  }

  // Per-row push outcome columns.
  if (!(await columnExists("ImportRow", "pushStatus"))) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `ImportRow` ADD COLUMN `pushStatus` VARCHAR(20) NOT NULL DEFAULT 'pending'"
    );
  }
  if (!(await columnExists("ImportRow", "pushError"))) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `ImportRow` ADD COLUMN `pushError` TEXT NULL"
    );
  }
  if (!(await columnExists("ImportRow", "title"))) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `ImportRow` ADD COLUMN `title` VARCHAR(500) NULL"
    );
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
    CREATE TABLE IF NOT EXISTS \`Collection\` (
      \`id\` BIGINT NOT NULL AUTO_INCREMENT,
      \`storeId\` BIGINT NOT NULL,
      \`shopifyCollectionId\` VARCHAR(255) NOT NULL,
      \`handle\` VARCHAR(255) NULL,
      \`title\` VARCHAR(500) NULL,
      \`bodyHtml\` LONGTEXT NULL,
      \`sortOrder\` VARCHAR(50) NULL,
      \`templateSuffix\` VARCHAR(255) NULL,
      \`isSmart\` TINYINT(1) NOT NULL DEFAULT 0,
      \`productsCount\` INT NOT NULL DEFAULT 0,
      \`seoTitle\` VARCHAR(255) NULL,
      \`seoDescription\` TEXT NULL,
      \`rawShopifyJson\` JSON NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`Collection_storeId_idx\` (\`storeId\`),
      UNIQUE INDEX \`Collection_storeId_shopifyCollectionId_unique\` (\`storeId\`, \`shopifyCollectionId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`CollectionMetafield\` (
      \`id\` BIGINT NOT NULL AUTO_INCREMENT,
      \`storeId\` BIGINT NOT NULL,
      \`collectionId\` BIGINT NOT NULL,
      \`shopifyMetafieldId\` VARCHAR(255) NULL,
      \`namespace\` VARCHAR(255) NOT NULL,
      \`metafieldKey\` VARCHAR(255) NOT NULL,
      \`type\` VARCHAR(255) NOT NULL,
      \`value\` MEDIUMTEXT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`CollectionMetafield_collectionId_idx\` (\`collectionId\`),
      INDEX \`CollectionMetafield_storeId_idx\` (\`storeId\`),
      UNIQUE INDEX \`CollectionMetafield_collectionId_namespace_key_unique\` (\`collectionId\`, \`namespace\`, \`metafieldKey\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`AppSetting\` (
      \`settingKey\` VARCHAR(100) NOT NULL,
      \`value\` TEXT NULL,
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`settingKey\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`SyncJob\` (
      \`id\` BIGINT NOT NULL AUTO_INCREMENT,
      \`storeId\` BIGINT NOT NULL,
      \`status\` ENUM('queued','running','success','failed') NOT NULL DEFAULT 'queued',
      \`phase\` VARCHAR(50) NOT NULL DEFAULT 'pending',
      \`currentCount\` INT NOT NULL DEFAULT 0,
      \`totalCount\` INT NULL,
      \`message\` TEXT NULL,
      \`startedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`finishedAt\` DATETIME(3) NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`SyncJob_storeId_idx\` (\`storeId\`),
      INDEX \`SyncJob_storeId_startedAt_idx\` (\`storeId\`, \`startedAt\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  if (!(await indexExists("Variant", "Variant_storeId_shopifyVariantId_unique"))) {
    try {
      await prisma.$executeRawUnsafe(
        "ALTER TABLE `Variant` ADD UNIQUE INDEX `Variant_storeId_shopifyVariantId_unique` (`storeId`, `shopifyVariantId`)"
      );
      console.info("[schema-bootstrap] added Variant (storeId, shopifyVariantId) unique index");
    } catch (error) {
      // index may already exist under a different name; non-fatal
      console.warn("[schema-bootstrap] could not add Variant unique index:", error);
    }
  }

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
    bootstrapPromise = bootstrap()
      .then(async () => {
        // Lazy-start the smart-sync scheduler the first time any API hits the
        // DB. We can't do this from src/instrumentation.ts because that file
        // is bundled for both Node and Edge runtimes — pulling in Prisma there
        // breaks the Edge build (no wasm engine). Doing it here keeps the
        // import chain Node-only.
        try {
          const mod = await import("@/lib/sync-scheduler");
          mod.ensureSmartSyncScheduler();
        } catch (error) {
          console.warn("[schema-bootstrap] failed to start smart-sync scheduler", error);
        }
      })
      .catch((error) => {
        console.error("[schema-bootstrap] failed:", error);
        bootstrapPromise = null;
        throw error;
      });
  }
  return bootstrapPromise;
}
