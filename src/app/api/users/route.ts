import { NextRequest, NextResponse } from "next/server";

import { DEFAULT_ADMIN_USERNAME } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { getPrismaClient } from "@/lib/prisma";

const VALID_ROLES = ["admin", "manager", "editor", "viewer"] as const;
type Role = (typeof VALID_ROLES)[number];

const BUILTIN_ADMIN = {
  id: 0,
  name: "Built-in administrator",
  email: DEFAULT_ADMIN_USERNAME,
  role: "admin" as const,
  builtin: true,
  createdAt: new Date(0).toISOString()
};

export async function GET() {
  const prisma = getPrismaClient();
  try {
    const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({
      items: [
        BUILTIN_ADMIN,
        ...users.map((user) => ({
          id: Number(user.id),
          name: user.name,
          email: user.email,
          role: user.role,
          builtin: false,
          createdAt: user.createdAt.toISOString()
        }))
      ]
    });
  } catch {
    return NextResponse.json({ items: [BUILTIN_ADMIN] });
  }
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => ({}));
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  const role = (payload?.role as Role) ?? "viewer";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const prisma = getPrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 });
    }
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { name: name || null, email, passwordHash, role }
    });
    return NextResponse.json({
      success: true,
      item: { id: Number(user.id), name: user.name, email: user.email, role: user.role }
    });
  } catch {
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}
