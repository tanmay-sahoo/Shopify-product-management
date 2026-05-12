import { clsx } from "clsx";

export function cn(...inputs: Array<string | false | null | undefined>) {
  return clsx(inputs);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function currency(value: number, currencyCode?: string | null) {
  const code = (currencyCode ?? "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(value);
  } catch {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value);
  }
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
