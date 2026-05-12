import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prismaClient?: PrismaClient };

export function getPrismaClient() {
  if (globalForPrisma.prismaClient) {
    return globalForPrisma.prismaClient;
  }

  const prismaClient = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prismaClient = prismaClient;
  }

  return prismaClient;
}
