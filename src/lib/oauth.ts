import crypto from "node:crypto";

const REQUIRED_SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_files",
  "write_files",
  "read_locations",
  "read_metafields",
  "write_metafields"
];

export function validateShopDomain(shop: string) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop.trim());
}

export function createOAuthState() {
  return crypto.randomBytes(16).toString("hex");
}

type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function resolveShopifyRedirectUri() {
  if (process.env.SHOPIFY_REDIRECT_URI) {
    return process.env.SHOPIFY_REDIRECT_URI;
  }

  if (!process.env.APP_URL) {
    throw new Error("APP_URL or SHOPIFY_REDIRECT_URI is required");
  }

  return `${process.env.APP_URL.replace(/\/$/, "")}/api/auth/shopify/callback`;
}

export function resolveOAuthConfig(overrides?: Partial<OAuthConfig>): OAuthConfig {
  const clientId = overrides?.clientId;
  const clientSecret = overrides?.clientSecret;
  const redirectUri = overrides?.redirectUri ?? resolveShopifyRedirectUri();

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing Shopify OAuth credentials");
  }

  return { clientId, clientSecret, redirectUri };
}

export function buildShopifyInstallUrl(
  shop: string,
  state: string,
  oauthConfig?: Partial<OAuthConfig>
) {
  const { clientId, redirectUri } = resolveOAuthConfig(oauthConfig);
  const scopes = process.env.SHOPIFY_SCOPES ?? REQUIRED_SCOPES.join(",");

  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state
  });

  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

function hmacDigest(message: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

function safeCompare(a: string, b: string) {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function verifyShopifyHmac(
  searchParams: URLSearchParams,
  clientSecret: string,
  rawQueryString?: string
) {
  const hmac = (searchParams.get("hmac") ?? "").toLowerCase();
  if (!hmac) return false;

  const decodedMessage = [...searchParams.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  if (safeCompare(hmacDigest(decodedMessage, clientSecret), hmac)) return true;

  if (rawQueryString) {
    const rawParts = rawQueryString
      .replace(/^\?/, "")
      .split("&")
      .filter((part) => part && !part.startsWith("hmac=") && !part.startsWith("signature="))
      .sort();
    const rawMessage = rawParts.join("&");
    if (safeCompare(hmacDigest(rawMessage, clientSecret), hmac)) return true;
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "[shopify hmac] mismatch",
      JSON.stringify({
        receivedHmac: hmac,
        computedDecoded: hmacDigest(decodedMessage, clientSecret),
        decodedMessage,
        hasRaw: Boolean(rawQueryString)
      })
    );
  }

  return false;
}

export async function exchangeCodeForAccessToken(
  shop: string,
  code: string,
  oauthConfig?: Partial<OAuthConfig>
) {
  const { clientId, clientSecret } = resolveOAuthConfig(oauthConfig);

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to exchange Shopify code: ${response.status}`);
  }

  return response.json() as Promise<{ access_token: string; scope: string }>;
}

function normaliseKey(key: string) {
  const buffer = Buffer.from(key, "utf8");
  return buffer.length >= 32 ? buffer.subarray(0, 32) : Buffer.concat([buffer, Buffer.alloc(32 - buffer.length)]);
}

export function encryptValue(value: string) {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required");
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", normaliseKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptValue(encryptedValue: string) {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required");
  }

  const [ivHex, payloadHex] = encryptedValue.split(":");
  if (!ivHex || !payloadHex) {
    throw new Error("Invalid encrypted payload format");
  }

  const iv = Buffer.from(ivHex, "hex");
  const payload = Buffer.from(payloadHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", normaliseKey(secret), iv);
  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
  return decrypted.toString("utf8");
}
