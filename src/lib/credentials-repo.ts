import { Prisma } from "@prisma/client";

import { getPrismaClient } from "@/lib/prisma";
import { ensureSchemaCompatibility } from "@/lib/schema-bootstrap";

export type CredentialRow = {
  id: bigint;
  name: string;
  clientId: string;
  clientSecretEncrypted: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function listCredentials(): Promise<CredentialRow[]> {
  await ensureSchemaCompatibility();
  return getPrismaClient().$queryRaw<CredentialRow[]>(
    Prisma.sql`SELECT \`id\`, \`name\`, \`clientId\`, \`clientSecretEncrypted\`, \`notes\`, \`createdAt\`, \`updatedAt\`
               FROM \`ShopifyAppCredential\`
               ORDER BY \`createdAt\` DESC`
  );
}

export async function findCredentialById(id: bigint): Promise<CredentialRow | null> {
  await ensureSchemaCompatibility();
  const rows = await getPrismaClient().$queryRaw<CredentialRow[]>(
    Prisma.sql`SELECT \`id\`, \`name\`, \`clientId\`, \`clientSecretEncrypted\`, \`notes\`, \`createdAt\`, \`updatedAt\`
               FROM \`ShopifyAppCredential\`
               WHERE \`id\` = ${id}
               LIMIT 1`
  );
  return rows[0] ?? null;
}

export async function createCredential(input: {
  name: string;
  clientId: string;
  clientSecretEncrypted: string;
  notes: string | null;
}): Promise<CredentialRow> {
  await ensureSchemaCompatibility();
  const prisma = getPrismaClient();
  await prisma.$executeRaw(
    Prisma.sql`INSERT INTO \`ShopifyAppCredential\`
               (\`name\`, \`clientId\`, \`clientSecretEncrypted\`, \`notes\`, \`createdAt\`, \`updatedAt\`)
               VALUES (${input.name}, ${input.clientId}, ${input.clientSecretEncrypted}, ${input.notes}, NOW(3), NOW(3))`
  );
  const rows = await prisma.$queryRaw<CredentialRow[]>(
    Prisma.sql`SELECT \`id\`, \`name\`, \`clientId\`, \`clientSecretEncrypted\`, \`notes\`, \`createdAt\`, \`updatedAt\`
               FROM \`ShopifyAppCredential\`
               WHERE \`clientId\` = ${input.clientId}
               LIMIT 1`
  );
  if (!rows[0]) {
    throw new Error("Failed to read back created credential.");
  }
  return rows[0];
}

export async function deleteCredential(id: bigint): Promise<number> {
  await ensureSchemaCompatibility();
  const result = await getPrismaClient().$executeRaw(
    Prisma.sql`DELETE FROM \`ShopifyAppCredential\` WHERE \`id\` = ${id}`
  );
  return Number(result);
}
