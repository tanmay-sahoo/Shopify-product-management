import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  verifyCredentials as verifyEnvCredentials
} from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { getPrismaClient } from "@/lib/prisma";

export type AuthenticatedIdentity = {
  username: string;
  source: "env" | "db";
  role?: string;
};

export async function verifyLogin(
  rawIdentifier: string,
  password: string
): Promise<AuthenticatedIdentity | null> {
  const identifier = rawIdentifier.trim();
  if (!identifier || !password) return null;

  if (verifyEnvCredentials(identifier, password)) {
    return { username: DEFAULT_ADMIN_USERNAME, source: "env", role: "admin" };
  }

  if (identifier === DEFAULT_ADMIN_USERNAME && password === DEFAULT_ADMIN_PASSWORD) {
    return { username: DEFAULT_ADMIN_USERNAME, source: "env", role: "admin" };
  }

  const email = identifier.toLowerCase();
  if (!email.includes("@")) {
    return null;
  }

  try {
    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) return null;
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return null;
    return { username: user.email ?? String(user.id), source: "db", role: user.role };
  } catch {
    return null;
  }
}
