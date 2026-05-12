import { z } from "zod";

import type { ImportRow } from "@/lib/types";

export const shopDomainSchema = z
  .string()
  .trim()
  .min(1, "Store URL is required")
  .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i, "Use a valid myshopify.com domain");

export const productPatchSchema = z.object({
  title: z.string().trim().min(1).optional(),
  vendor: z.string().trim().optional(),
  productType: z.string().trim().optional(),
  status: z.enum(["active", "draft", "archived"]).optional(),
  tags: z.array(z.string()).optional(),
  seoTitle: z.string().trim().optional(),
  seoDescription: z.string().trim().optional()
});

export const variantPatchSchema = z.object({
  sku: z.string().trim().min(1).optional(),
  price: z.number().nonnegative().optional(),
  compareAtPrice: z.number().nonnegative().optional(),
  inventoryQuantity: z.number().int().optional(),
  barcode: z.string().trim().optional()
});

export const importRowSchema = z.object({
  handle: z.string().trim().min(1, "Handle is required"),
  title: z.string().trim().min(1, "Title is required"),
  sku: z.string().trim().min(1, "SKU is required"),
  price: z.string().trim(),
  inventory: z.string().trim(),
  imageColumns: z.array(z.string().trim())
});

export function validateImportRows(rows: Omit<ImportRow, "validationErrors" | "validationStatus" | "actionType">[]) {
  const seenSkus = new Set<string>();

  return rows.map((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const parsed = importRowSchema.safeParse(row);

    if (!parsed.success) {
      errors.push(...parsed.error.issues.map((issue) => issue.message));
    }

    const price = Number(row.price);
    if (!Number.isFinite(price)) {
      errors.push("Price must be numeric");
    }

    const inventory = Number(row.inventory);
    if (!Number.isInteger(inventory)) {
      errors.push("Inventory must be an integer");
    }

    if (seenSkus.has(row.sku)) {
      errors.push("Duplicate SKU found in file");
    } else {
      seenSkus.add(row.sku);
    }

    row.imageColumns.forEach((url, index) => {
      if (!url) {
        return;
      }

      try {
        new URL(url);
      } catch {
        errors.push(`Image ${index + 1} must be a valid URL`);
      }
    });

    if (row.imageColumns.filter(Boolean).length === 0) {
      warnings.push("Missing primary image");
    }

    return {
      ...row,
      validationErrors: [...errors, ...warnings],
      validationStatus: errors.length ? "error" : warnings.length ? "warning" : "valid",
      actionType: row.handle.startsWith("new-") ? "create_product" : "update_variant"
    } as ImportRow;
  });
}
