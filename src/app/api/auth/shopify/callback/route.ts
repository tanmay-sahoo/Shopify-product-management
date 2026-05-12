import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import {
  decryptValue,
  encryptValue,
  exchangeCodeForAccessToken,
  resolveShopifyRedirectUri,
  validateShopDomain,
  verifyShopifyHmac
} from "@/lib/oauth";
import { fetchShopInfo } from "@/lib/shopify";
import { ACTIVE_STORE_COOKIE, ACTIVE_STORE_COOKIE_MAX_AGE } from "@/lib/active-store";
import { getPrismaClient } from "@/lib/prisma";
import { ensureSchemaCompatibility } from "@/lib/schema-bootstrap";

function redirectError(request: NextRequest, message: string) {
  const url = new URL("/settings", request.url);
  url.searchParams.set("status", "error");
  url.searchParams.set("message", message);
  return NextResponse.redirect(url);
}

function classifyError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  const message = error.message ?? "";

  if (/Failed to exchange Shopify code/i.test(message)) return "token_exchange_failed";
  if (/P2002/.test(message)) return "duplicate_shop";
  if (/P2003/.test(message)) return "foreign_key_failed";
  if (/P2025/.test(message)) return "record_missing";
  if (/P2021/.test(message) || /table .* doesn.?t exist/i.test(message)) return "db_table_missing";
  if (/P1001/.test(message) || /Can't reach database/i.test(message)) return "db_unreachable";
  if (/TOKEN_ENCRYPTION_KEY/.test(message)) return "missing_encryption_key";

  return message
    .split("\n")[0]
    .replace(/Invalid `[^`]+`/g, "invalid_prisma_call")
    .slice(0, 120) || "unknown_error";
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const state = url.searchParams.get("state");
  const shop = url.searchParams.get("shop");
  const code = url.searchParams.get("code");

  if (!shop || !code || !state || !validateShopDomain(shop)) {
    return redirectError(request, "invalid_callback_payload");
  }

  const prisma = getPrismaClient();

  let oauthSession;
  try {
    oauthSession = await prisma.oAuthSession.findUnique({ where: { state } });
  } catch (error) {
    console.error("[shopify callback] OAuthSession lookup failed:", error);
    return redirectError(request, classifyError(error));
  }

  if (
    !oauthSession ||
    oauthSession.shopDomain !== shop ||
    oauthSession.usedAt ||
    oauthSession.expiresAt < new Date()
  ) {
    return redirectError(request, "oauth_state_mismatch");
  }

  const clientId = oauthSession.clientId;
  let clientSecret: string;
  try {
    clientSecret = decryptValue(oauthSession.clientSecretEncrypted);
  } catch (error) {
    console.error("[shopify callback] decrypt failed:", error);
    return redirectError(request, "decrypt_failed");
  }

  const rawQueryString = request.url.includes("?") ? request.url.split("?")[1] : "";
  if (!verifyShopifyHmac(url.searchParams, clientSecret, rawQueryString)) {
    console.error("[shopify callback] HMAC verification failed", {
      shop,
      clientIdSuffix: clientId.slice(-6),
      hasSecret: clientSecret.length > 0,
      paramsKeys: Array.from(url.searchParams.keys()).filter((key) => key !== "hmac")
    });
    return redirectError(request, "invalid_hmac");
  }

  let tokenResponse;
  try {
    tokenResponse = await exchangeCodeForAccessToken(shop, code, {
      clientId,
      clientSecret,
      redirectUri: resolveShopifyRedirectUri()
    });
  } catch (error) {
    console.error("[shopify callback] token exchange failed:", error);
    return redirectError(request, "token_exchange_failed");
  }

  let encryptedToken: string;
  let encryptedSecret: string;
  try {
    encryptedToken = encryptValue(tokenResponse.access_token);
    encryptedSecret = encryptValue(clientSecret);
  } catch (error) {
    console.error("[shopify callback] encrypt failed:", error);
    return redirectError(request, "encrypt_failed");
  }

  const oauthNameCookie = request.cookies.get(`lns_oauth_name_${state}`)?.value ?? "";
  const desiredDisplayName = oauthNameCookie.trim();

  try {
    await ensureSchemaCompatibility();

    const shopInfo = await fetchShopInfo(shop, tokenResponse.access_token);

    const existing = await prisma.store.findUnique({ where: { shopDomain: shop } });
    const createData: Record<string, unknown> = {
      shopDomain: shop,
      shopifyClientId: clientId,
      shopifyClientSecretEncrypted: encryptedSecret,
      accessTokenEncrypted: encryptedToken,
      scopes: tokenResponse.scope,
      status: "active",
      installedAt: new Date(),
      lastSyncAt: null
    };
    const updateData: Record<string, unknown> = {
      shopifyClientId: clientId,
      shopifyClientSecretEncrypted: encryptedSecret,
      accessTokenEncrypted: encryptedToken,
      scopes: tokenResponse.scope,
      status: "active",
      installedAt: new Date()
    };

    if (desiredDisplayName) {
      createData.displayName = desiredDisplayName;
      if (!existing?.displayName) {
        updateData.displayName = desiredDisplayName;
      }
    }

    await prisma.$transaction([
      prisma.oAuthSession.update({
        where: { state },
        data: { usedAt: new Date() }
      }),
      prisma.store.upsert({
        where: { shopDomain: shop },
        create: createData as Parameters<typeof prisma.store.upsert>[0]["create"],
        update: updateData as Parameters<typeof prisma.store.upsert>[0]["update"]
      })
    ]);

    if (shopInfo?.currencyCode) {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE \`Store\` SET \`currencyCode\` = ${shopInfo.currencyCode} WHERE \`shopDomain\` = ${shop}`
      );
    }
  } catch (error) {
    console.error("[shopify callback] DB write failed:", error);
    return redirectError(request, classifyError(error));
  }

  const successUrl = new URL("/settings", request.url);
  successUrl.searchParams.set("status", "success");
  successUrl.searchParams.set("shop", shop);
  successUrl.searchParams.set("scopes", tokenResponse.scope);
  successUrl.searchParams.set("token", `${encryptedToken.slice(0, 12)}...`);

  const response = NextResponse.redirect(successUrl);
  response.cookies.delete(`lns_oauth_name_${state}`);

  try {
    const connected = await prisma.store.findUnique({ where: { shopDomain: shop }, select: { id: true } });
    if (connected) {
      response.cookies.set(ACTIVE_STORE_COOKIE, String(connected.id), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: ACTIVE_STORE_COOKIE_MAX_AGE
      });
    }
  } catch (error) {
    console.error("[shopify callback] failed to set active store cookie:", error);
  }

  void registerProductWebhooks(shop, tokenResponse.access_token, request).catch((error) => {
    console.warn("[shopify callback] webhook registration skipped:", error?.message ?? error);
  });

  return response;
}

async function registerProductWebhooks(shop: string, accessToken: string, request: NextRequest) {
  const callbackUrl = process.env.SHOPIFY_WEBHOOK_URL?.trim();
  const fallback = `${new URL(request.url).origin}/api/webhooks/shopify/products`;
  const target = callbackUrl && callbackUrl.length > 0 ? callbackUrl : fallback;

  if (target.includes("localhost") || target.includes("127.0.0.1")) {
    console.info("[shopify callback] skipping webhook registration for local URL:", target);
    return;
  }

  const topics = [
    "products/update",
    "products/create",
    "products/delete",
    "inventory_levels/update",
    "orders/create",
    "orders/paid",
    "orders/cancelled",
    "refunds/create"
  ];
  for (const topic of topics) {
    await fetch(`https://${shop}/admin/api/2025-10/webhooks.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken
      },
      body: JSON.stringify({
        webhook: { topic, address: target, format: "json" }
      })
    });
  }
}
