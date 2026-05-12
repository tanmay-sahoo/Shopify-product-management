import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { decryptValue } from "@/lib/oauth";
import { getPrismaClient } from "@/lib/prisma";
import {
  handleInventoryLevelUpdate,
  handleOrderCancelled,
  handleOrderCreate,
  handleProductUpdate,
  handleRefundCreate
} from "@/lib/inventory-sync/webhook-dispatcher";

function verifyHmac(body: string, signature: string, secret: string) {
  const digest = crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
  if (digest.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

function mapStatus(value: string | null | undefined): "active" | "draft" | "archived" {
  const lowered = (value ?? "").toLowerCase();
  if (lowered === "active") return "active";
  if (lowered === "archived") return "archived";
  return "draft";
}

type RestVariant = {
  id: number;
  title?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price?: string | null;
  compare_at_price?: string | null;
  inventory_quantity?: number | null;
  inventory_item_id?: number | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
};

type RestImage = {
  id: number;
  src?: string | null;
  alt?: string | null;
  position?: number | null;
};

type RestProduct = {
  id: number;
  handle?: string | null;
  title?: string | null;
  body_html?: string | null;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string | string[] | null;
  status?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  variants?: RestVariant[];
  images?: RestImage[];
};

function gidForProduct(restId: number) {
  return `gid://shopify/Product/${restId}`;
}
function gidForVariant(restId: number) {
  return `gid://shopify/ProductVariant/${restId}`;
}
function gidForInventoryItem(restId: number) {
  return `gid://shopify/InventoryItem/${restId}`;
}
function gidForMediaImage(restId: number) {
  return `gid://shopify/MediaImage/${restId}`;
}

async function upsertProductFromWebhook(storeId: bigint, payload: RestProduct) {
  const db = getPrismaClient();
  const productGid = gidForProduct(payload.id);
  const tagsValue = Array.isArray(payload.tags) ? payload.tags.join(", ") : (payload.tags ?? "");

  const productData = {
    handle: payload.handle ?? "",
    title: payload.title ?? "",
    bodyHtml: payload.body_html ?? "",
    vendor: payload.vendor ?? "",
    productType: payload.product_type ?? "",
    tags: tagsValue,
    status: mapStatus(payload.status),
    seoTitle: payload.seo_title ?? "",
    seoDescription: payload.seo_description ?? "",
    rawShopifyJson: payload as unknown as Prisma.InputJsonValue
  };

  const product = await db.product.upsert({
    where: { storeId_shopifyProductId: { storeId, shopifyProductId: productGid } },
    create: { storeId, shopifyProductId: productGid, ...productData },
    update: productData
  });

  const variants = Array.isArray(payload.variants) ? payload.variants : [];
  const seenVariantGids = new Set<string>();

  for (const variant of variants) {
    const variantGid = gidForVariant(variant.id);
    seenVariantGids.add(variantGid);

    const variantData = {
      sku: variant.sku ?? "",
      barcode: variant.barcode ?? "",
      title: variant.title ?? "",
      option1Name: variant.option1 ? "Option 1" : "Option 1",
      option1Value: variant.option1 ?? variant.title ?? "",
      option2Name: variant.option2 ? "Option 2" : null,
      option2Value: variant.option2 ?? null,
      option3Name: variant.option3 ? "Option 3" : null,
      option3Value: variant.option3 ?? null,
      price: variant.price ? new Prisma.Decimal(variant.price) : null,
      compareAtPrice: variant.compare_at_price ? new Prisma.Decimal(variant.compare_at_price) : null,
      inventoryQuantity: variant.inventory_quantity ?? 0,
      inventoryItemId: variant.inventory_item_id ? gidForInventoryItem(variant.inventory_item_id) : null,
      rawShopifyJson: variant as unknown as Prisma.InputJsonValue
    };

    const existing = await db.variant.findFirst({
      where: { storeId, shopifyVariantId: variantGid }
    });
    if (existing) {
      await db.variant.update({ where: { id: existing.id }, data: variantData });
    } else {
      await db.variant.create({
        data: {
          storeId,
          productId: product.id,
          shopifyVariantId: variantGid,
          ...variantData
        }
      });
    }
  }

  if (seenVariantGids.size > 0) {
    await db.variant.deleteMany({
      where: {
        storeId,
        productId: product.id,
        shopifyVariantId: { notIn: Array.from(seenVariantGids) }
      }
    });
  }

  const images = Array.isArray(payload.images) ? payload.images : [];
  const seenImageGids = new Set<string>();

  for (const image of images) {
    const mediaGid = gidForMediaImage(image.id);
    seenImageGids.add(mediaGid);

    const imageData = {
      sourceUrl: image.src ?? "",
      altText: image.alt ?? "",
      position: image.position ?? 0,
      status: "linked" as const
    };

    const existing = await db.productImage.findFirst({
      where: { storeId, productId: product.id, shopifyMediaId: mediaGid }
    });
    if (existing) {
      await db.productImage.update({ where: { id: existing.id }, data: imageData });
    } else {
      await db.productImage.create({
        data: {
          storeId,
          productId: product.id,
          shopifyMediaId: mediaGid,
          ...imageData
        }
      });
    }
  }

  if (seenImageGids.size > 0) {
    await db.productImage.deleteMany({
      where: {
        storeId,
        productId: product.id,
        shopifyMediaId: { notIn: Array.from(seenImageGids) }
      }
    });
  }

  return { productId: Number(product.id), variantsTouched: variants.length, imagesTouched: images.length };
}

async function deleteProductFromWebhook(storeId: bigint, restProductId: number) {
  const db = getPrismaClient();
  const productGid = gidForProduct(restProductId);
  const product = await db.product.findUnique({
    where: { storeId_shopifyProductId: { storeId, shopifyProductId: productGid } }
  });
  if (!product) return { deleted: false };

  await db.variantImage.deleteMany({ where: { productId: product.id } });
  await db.productImage.deleteMany({ where: { productId: product.id } });
  await db.variant.deleteMany({ where: { productId: product.id } });
  await db.product.delete({ where: { id: product.id } });
  return { deleted: true };
}

type InventoryLevelPayload = {
  inventory_item_id?: number;
  available?: number;
};

async function applyInventoryUpdate(storeId: bigint, payload: InventoryLevelPayload) {
  const db = getPrismaClient();
  if (!payload.inventory_item_id || typeof payload.available !== "number") {
    return { updated: 0 };
  }
  const gid = gidForInventoryItem(payload.inventory_item_id);
  const result = await db.variant.updateMany({
    where: { storeId, inventoryItemId: gid },
    data: { inventoryQuantity: payload.available }
  });
  return { updated: result.count };
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const shop = request.headers.get("x-shopify-shop-domain") ?? "";
  const signature = request.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = request.headers.get("x-shopify-topic") ?? "";

  if (!shop || !signature) {
    return NextResponse.json({ error: "Missing Shopify headers" }, { status: 400 });
  }

  const prisma = getPrismaClient();
  const store = await prisma.store.findUnique({ where: { shopDomain: shop } });
  if (!store?.shopifyClientSecretEncrypted) {
    return NextResponse.json({ error: "Unknown shop" }, { status: 401 });
  }

  let clientSecret: string;
  try {
    clientSecret = decryptValue(store.shopifyClientSecretEncrypted);
  } catch {
    return NextResponse.json({ error: "Failed to decrypt secret" }, { status: 500 });
  }

  if (!verifyHmac(body, signature, clientSecret)) {
    console.warn(`[webhook] HMAC verification failed for ${shop} (${topic})`);
    return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    let outcome: Record<string, unknown> = {};
    switch (topic) {
      case "products/create":
      case "products/update": {
        outcome = await upsertProductFromWebhook(store.id, payload as RestProduct);
        const linkedOutcome = await handleProductUpdate(
          Number(store.id),
          payload as { id?: number; variants?: Array<{ id?: number; price?: string }> }
        );
        if (linkedOutcome.matched > 0) {
          (outcome as Record<string, unknown>).linkedSync = linkedOutcome;
        }
        break;
      }
      case "products/delete": {
        const productId = (payload as { id?: number }).id;
        if (typeof productId === "number") {
          outcome = await deleteProductFromWebhook(store.id, productId);
        }
        break;
      }
      case "inventory_levels/update": {
        const baseOutcome = await applyInventoryUpdate(store.id, payload as InventoryLevelPayload);
        const linked = await handleInventoryLevelUpdate(
          Number(store.id),
          payload as Parameters<typeof handleInventoryLevelUpdate>[1]
        );
        outcome = { ...baseOutcome, linkedSync: linked };
        break;
      }
      case "orders/create":
      case "orders/paid": {
        outcome = await handleOrderCreate(
          Number(store.id),
          payload as Parameters<typeof handleOrderCreate>[1]
        );
        break;
      }
      case "orders/cancelled": {
        outcome = await handleOrderCancelled(
          Number(store.id),
          payload as Parameters<typeof handleOrderCancelled>[1]
        );
        break;
      }
      case "refunds/create": {
        outcome = await handleRefundCreate(
          Number(store.id),
          payload as Parameters<typeof handleRefundCreate>[1]
        );
        break;
      }
      default: {
        outcome = { skipped: true, reason: "unhandled topic" };
      }
    }

    await prisma.syncLog.create({
      data: {
        storeId: store.id,
        jobType: `webhook.${topic}`,
        status: "success",
        message: JSON.stringify(outcome),
        startedAt: new Date(),
        completedAt: new Date()
      }
    });

    console.info(`[webhook] ${topic} ${shop}`, outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[webhook] handler for ${topic} failed:`, error);
    await prisma.syncLog
      .create({
        data: {
          storeId: store.id,
          jobType: `webhook.${topic}`,
          status: "failed",
          message: message.slice(0, 500),
          startedAt: new Date(),
          completedAt: new Date()
        }
      })
      .catch(() => {});
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
