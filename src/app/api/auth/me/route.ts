import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { AUTH_COOKIE, DEFAULT_ADMIN_USERNAME, verifySessionToken } from "@/lib/auth";
import { getPrismaClient } from "@/lib/prisma";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  if (session.username === DEFAULT_ADMIN_USERNAME) {
    return NextResponse.json({
      user: {
        name: "Built-in administrator",
        email: DEFAULT_ADMIN_USERNAME,
        role: "admin",
        source: "env"
      }
    });
  }

  try {
    const user = await getPrismaClient().user.findUnique({ where: { email: session.username } });
    if (user) {
      return NextResponse.json({
        user: {
          name: user.name,
          email: user.email,
          role: user.role,
          source: "db"
        }
      });
    }
  } catch {
    // fall through
  }

  return NextResponse.json({
    user: { name: session.username, email: session.username, role: "viewer", source: "session" }
  });
}
