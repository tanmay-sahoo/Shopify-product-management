import { NextRequest, NextResponse } from "next/server";

import { hashPassword } from "@/lib/password";
import { getPrismaClient } from "@/lib/prisma";

const VALID_ROLES = ["admin", "manager", "editor", "viewer"] as const;
type Role = (typeof VALID_ROLES)[number];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = await request.json().catch(() => ({}));

  const data: Record<string, unknown> = {};

  if (typeof payload?.name === "string") {
    data.name = payload.name.trim() || null;
  }
  if (typeof payload?.email === "string" && payload.email.trim()) {
    data.email = payload.email.trim().toLowerCase();
  }
  if (typeof payload?.role === "string") {
    if (!VALID_ROLES.includes(payload.role as Role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    data.role = payload.role;
  }
  if (typeof payload?.password === "string" && payload.password.length > 0) {
    if (payload.password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    data.passwordHash = await hashPassword(payload.password);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const updated = await getPrismaClient().user.update({
      where: { id: BigInt(id) },
      data
    });
    return NextResponse.json({
      success: true,
      item: {
        id: Number(updated.id),
        name: updated.name,
        email: updated.email,
        role: updated.role
      }
    });
  } catch (error) {
    const message =
      error instanceof Error && /unique/i.test(error.message)
        ? "Another user already has that email."
        : "Failed to update user.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await getPrismaClient().user.delete({ where: { id: BigInt(id) } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete user" }, { status: 400 });
  }
}
