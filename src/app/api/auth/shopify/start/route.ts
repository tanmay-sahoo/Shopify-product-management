import { NextRequest, NextResponse } from "next/server";

import { findCredentialById } from "@/lib/credentials-repo";
import {
  buildShopifyInstallUrl,
  createOAuthState,
  decryptValue,
  encryptValue,
  resolveShopifyRedirectUri,
  validateShopDomain
} from "@/lib/oauth";
import { getPrismaClient } from "@/lib/prisma";

const OAUTH_NAME_COOKIE_PREFIX = "lns_oauth_name_";
const OAUTH_NAME_COOKIE_MAX_AGE = 10 * 60;

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const shop = String(formData.get("shop") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const credentialId = String(formData.get("credentialId") ?? "").trim();
  let clientId = String(formData.get("clientId") ?? "").trim();
  let clientSecret = String(formData.get("clientSecret") ?? "").trim();

  if (!validateShopDomain(shop)) {
    return NextResponse.json({ error: "Invalid shop domain" }, { status: 400 });
  }

  if (credentialId) {
    try {
      const saved = await findCredentialById(BigInt(credentialId));
      if (!saved) {
        return NextResponse.json({ error: "Saved credential not found" }, { status: 400 });
      }
      clientId = saved.clientId;
      clientSecret = decryptValue(saved.clientSecretEncrypted);
    } catch (error) {
      console.error("[POST /api/auth/shopify/start] credential lookup failed:", error);
      return NextResponse.json({ error: "Failed to load saved credential" }, { status: 500 });
    }
  }

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Client ID and Client Secret are required" }, { status: 400 });
  }

  const state = createOAuthState();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await getPrismaClient().oAuthSession.create({
    data: {
      state,
      shopDomain: shop,
      clientId,
      clientSecretEncrypted: encryptValue(clientSecret),
      expiresAt
    }
  });

  const response = NextResponse.redirect(
    buildShopifyInstallUrl(shop, state, {
      clientId,
      clientSecret,
      redirectUri: resolveShopifyRedirectUri()
    })
  );

  if (displayName) {
    response.cookies.set(`${OAUTH_NAME_COOKIE_PREFIX}${state}`, displayName, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: OAUTH_NAME_COOKIE_MAX_AGE
    });
  }

  return response;
}
