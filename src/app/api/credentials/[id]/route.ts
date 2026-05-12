import { NextRequest, NextResponse } from "next/server";

import { deleteCredential } from "@/lib/credentials-repo";

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const removed = await deleteCredential(BigInt(id));
    if (removed === 0) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/credentials/[id]] failed:", error);
    return NextResponse.json({ error: "Failed to delete credential" }, { status: 400 });
  }
}
