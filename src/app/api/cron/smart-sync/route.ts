import { NextResponse } from "next/server";

import { runSmartSyncTick } from "@/lib/sync-scheduler";

// Manual / external trigger for one smart-sync evaluation pass. Use this from
// a serverless cron (Vercel Cron, GitHub Actions schedule, external uptime
// pinger, etc.) when the in-process scheduler isn't reliable.
//
// Protect with CRON_SECRET if set: caller must send Authorization: Bearer <secret>.
async function authorize(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runSmartSyncTick();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tick failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export const GET = POST;
