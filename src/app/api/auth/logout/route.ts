import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { AUTH_COOKIE } from "@/lib/auth";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete("shopify_oauth_state");
  cookieStore.delete(AUTH_COOKIE);
  return NextResponse.json({ success: true });
}
