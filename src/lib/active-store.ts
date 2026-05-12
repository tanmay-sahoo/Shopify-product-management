import { cookies } from "next/headers";

export const ACTIVE_STORE_COOKIE = "lns_active_store";
export const ACTIVE_STORE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export async function readActiveStoreId(): Promise<number | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(ACTIVE_STORE_COOKIE)?.value;
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}
