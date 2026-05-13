import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { AUTH_COOKIE, verifySessionToken } from "@/lib/auth";
import { getAppSetting, setAppSetting, SETTING_KEYS } from "@/lib/app-settings";

const ALLOWED_INTERVALS = [0, 1, 2, 6, 12, 24];

async function requireAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  return verifySessionToken(token);
}

export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await getAppSetting(SETTING_KEYS.smartSyncIntervalHours);
  const parsed = raw === null ? 0 : Number(raw);
  const hours = ALLOWED_INTERVALS.includes(parsed) ? parsed : 0;
  return NextResponse.json({ intervalHours: hours });
}

export async function POST(request: Request) {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { intervalHours?: unknown };
  try {
    body = (await request.json()) as { intervalHours?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const value = Number(body.intervalHours);
  if (!Number.isFinite(value) || !ALLOWED_INTERVALS.includes(value)) {
    return NextResponse.json(
      { error: `intervalHours must be one of ${ALLOWED_INTERVALS.join(", ")}` },
      { status: 400 }
    );
  }

  await setAppSetting(SETTING_KEYS.smartSyncIntervalHours, String(value));
  return NextResponse.json({ intervalHours: value });
}
