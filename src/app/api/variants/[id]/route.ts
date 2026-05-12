import { NextRequest, NextResponse } from "next/server";

import { variantPatchSchema } from "@/lib/validation";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const payload = await request.json();
  const parsed = variantPatchSchema.safeParse(payload);
  const { id } = await params;

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    item: { id: Number(id), ...parsed.data },
    draftCreated: true
  });
}
