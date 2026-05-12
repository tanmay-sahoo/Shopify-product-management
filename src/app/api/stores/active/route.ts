import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { ACTIVE_STORE_COOKIE, ACTIVE_STORE_COOKIE_MAX_AGE } from "@/lib/active-store";
import { getPrismaClient } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => ({}));
  const id = Number(payload?.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid store id" }, { status: 400 });
  }

  try {
    const exists = await getPrismaClient().store.findUnique({ where: { id: BigInt(id) } });
    if (!exists) return NextResponse.json({ error: "Store not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_STORE_COOKIE, String(id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACTIVE_STORE_COOKIE_MAX_AGE
  });
  return NextResponse.json({ success: true });
}
