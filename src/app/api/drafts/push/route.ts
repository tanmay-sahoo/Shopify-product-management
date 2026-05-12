import { NextRequest, NextResponse } from "next/server";

import { getPrismaClient } from "@/lib/prisma";
import { pushDraftToShopify } from "@/lib/shopify-push";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => ({}));
  const ids = Array.isArray(payload?.ids)
    ? payload.ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isFinite(id))
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "No drafts selected" }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const results: { id: number; ok: boolean; message: string }[] = [];

  for (const id of ids as number[]) {
    let result;
    try {
      result = await pushDraftToShopify(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Push failed";
      result = { ok: false, message };
    }

    try {
      const draft = await prisma.draftChange.findUnique({ where: { id: BigInt(id) } });
      if (draft) {
        await prisma.draftChange.update({
          where: { id: BigInt(id) },
          data: { status: result.ok ? "pushed" : "failed" }
        });

        await prisma.syncLog.create({
          data: {
            storeId: draft.storeId,
            jobType: "shopify.pushDraft",
            status: result.ok ? "success" : "failed",
            message: `Draft #${id}: ${result.message}`,
            startedAt: new Date(),
            completedAt: new Date()
          }
        });
      }
    } catch (error) {
      console.error("[POST /api/drafts/push] failed to record outcome:", error);
    }

    results.push({ id, ...result });
  }

  const pushed = results.filter((result) => result.ok).length;
  const failed = results.length - pushed;

  return NextResponse.json({
    success: true,
    pushed,
    failed,
    results
  });
}
