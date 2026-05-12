export const AUTH_COOKIE = "lns_session";
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

const SIGNING_KEY =
  process.env.TOKEN_ENCRYPTION_KEY ?? "change-this-to-a-32-byte-secret-please";

export const DEFAULT_ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
export const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin@123456";

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getKey() {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(SIGNING_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function sign(value: string) {
  const key = await getKey();
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
}

async function verifySignature(value: string, signature: string) {
  const key = await getKey();
  try {
    return await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signature),
      encoder.encode(value)
    );
  } catch {
    return false;
  }
}

export async function createSessionToken(username: string) {
  const payload = `${username}|${Date.now()}`;
  const encoded = toBase64Url(encoder.encode(payload));
  const signature = await sign(encoded);
  return `${encoded}.${signature}`;
}

export async function verifySessionToken(
  token: string | undefined | null
): Promise<{ username: string } | null> {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const ok = await verifySignature(encoded, signature);
  if (!ok) return null;

  try {
    const bytes = fromBase64Url(encoded);
    const payload = new TextDecoder().decode(bytes);
    const [username] = payload.split("|");
    if (!username) return null;
    return { username };
  } catch {
    return null;
  }
}

export function verifyCredentials(username: string, password: string) {
  return username.trim() === DEFAULT_ADMIN_USERNAME && password === DEFAULT_ADMIN_PASSWORD;
}
