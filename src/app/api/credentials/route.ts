import { NextRequest, NextResponse } from "next/server";

import { createCredential, listCredentials } from "@/lib/credentials-repo";
import { encryptValue } from "@/lib/oauth";

function classifyError(error: unknown): string {
  if (!(error instanceof Error)) return "Failed to save credential.";
  const message = error.message ?? "";
  if (/Duplicate entry/i.test(message) || /P2002/.test(message) || /unique/i.test(message)) {
    return "A credential with this Client ID already exists.";
  }
  if (/TOKEN_ENCRYPTION_KEY/.test(message)) {
    return "TOKEN_ENCRYPTION_KEY is not configured in .env.";
  }
  if (/P1001/.test(message) || /Can't reach/i.test(message) || /ECONNREFUSED/.test(message)) {
    return "Cannot reach the database. Check DATABASE_URL.";
  }
  if (/Access denied/i.test(message)) {
    return "Database user does not have permission to create tables. Run the migration or grant permissions.";
  }
  return message.slice(0, 240) || "Failed to save credential.";
}

export async function GET() {
  try {
    const rows = await listCredentials();
    return NextResponse.json({
      items: rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        clientId: row.clientId,
        notes: row.notes,
        createdAt: new Date(row.createdAt).toISOString()
      }))
    });
  } catch (error) {
    console.error("[GET /api/credentials] failed:", error);
    return NextResponse.json({ items: [], warning: classifyError(error) });
  }
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => ({}));
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const clientId = typeof payload?.clientId === "string" ? payload.clientId.trim() : "";
  const clientSecret = typeof payload?.clientSecret === "string" ? payload.clientSecret : "";
  const notes = typeof payload?.notes === "string" ? payload.notes.trim() : "";

  if (!name || !clientId || !clientSecret) {
    return NextResponse.json({ error: "Name, Client ID, and Client Secret are required" }, { status: 400 });
  }

  try {
    const created = await createCredential({
      name,
      clientId,
      clientSecretEncrypted: encryptValue(clientSecret),
      notes: notes || null
    });
    return NextResponse.json({
      success: true,
      item: { id: Number(created.id), name: created.name, clientId: created.clientId }
    });
  } catch (error) {
    console.error("[POST /api/credentials] failed:", error);
    return NextResponse.json({ error: classifyError(error) }, { status: 400 });
  }
}
