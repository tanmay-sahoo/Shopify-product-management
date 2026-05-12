import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE, AUTH_COOKIE_MAX_AGE, createSessionToken } from "@/lib/auth";
import { verifyLogin } from "@/lib/login";

export async function POST(request: NextRequest) {
  let payload: { username?: string; password?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const username = String(payload.username ?? "").trim();
  const password = String(payload.password ?? "");

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }

  const identity = await verifyLogin(username, password);
  if (!identity) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  const token = await createSessionToken(identity.username);
  const response = NextResponse.json({ success: true });
  response.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE
  });
  return response;
}
