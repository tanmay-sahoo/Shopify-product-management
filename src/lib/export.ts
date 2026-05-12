import type { Product } from "@/lib/types";

type ExportOptions = {
  shopDomain?: string;
};

function storefrontHost(shopDomain?: string) {
  return shopDomain ?? "your-store.myshopify.com";
}

function escapeCsv(value: unknown) {
  const str = value === null || value === undefined ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

export function toEnhancedCsv(products: Product[], options: ExportOptions = {}) {
  const host = storefrontHost(options.shopDomain);

  const maxProductImages = products.reduce(
    (acc, product) => Math.max(acc, product.images.length),
    0
  );
  const imageColCount = Math.max(maxProductImages, 1);

  const headers = [
    "Handle",
    "Title",
    "Body (HTML)",
    "Vendor",
    "Type",
    "Tags",
    "Published",
    "Status",
    "SEO Title",
    "SEO Description",
    "Option1 Name",
    "Option1 Value",
    "Option2 Name",
    "Option2 Value",
    "Option3 Name",
    "Option3 Value",
    "Variant SKU",
    "Variant Barcode",
    "Variant Price",
    "Variant Compare At Price",
    "Variant Inventory Qty",
    "Variant Image",
    "Product URL",
    ...Array.from({ length: imageColCount }, (_, i) => `Image ${i + 1}`)
  ];

  const rows: string[][] = [];

  for (const product of products) {
    const productUrl = `https://${host}/products/${product.handle}`;
    const productImageCols = Array.from({ length: imageColCount }, (_, i) =>
      product.images[i]?.src ?? ""
    );

    if (product.variants.length === 0) {
      rows.push([
        product.handle,
        product.title,
        product.bodyHtml,
        product.vendor,
        product.productType,
        product.tags.join(", "),
        product.status === "active" ? "TRUE" : "FALSE",
        product.status,
        product.seoTitle,
        product.seoDescription,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        productUrl,
        ...productImageCols
      ]);
      continue;
    }

    product.variants.forEach((variant, index) => {
      const isFirst = index === 0;
      const variantImage =
        variant.variantImages.find((image) => image.isPrimary)?.src ??
        variant.variantImages[0]?.src ??
        variant.image ??
        "";

      rows.push([
        product.handle,
        isFirst ? product.title : "",
        isFirst ? product.bodyHtml : "",
        isFirst ? product.vendor : "",
        isFirst ? product.productType : "",
        isFirst ? product.tags.join(", ") : "",
        isFirst ? (product.status === "active" ? "TRUE" : "FALSE") : "",
        isFirst ? product.status : "",
        isFirst ? product.seoTitle : "",
        isFirst ? product.seoDescription : "",
        variant.option1Value ? "Option1" : "",
        variant.option1Value ?? "",
        variant.option2Value ? "Option2" : "",
        variant.option2Value ?? "",
        variant.option3Value ? "Option3" : "",
        variant.option3Value ?? "",
        variant.sku,
        variant.barcode ?? "",
        variant.price.toString(),
        variant.compareAtPrice?.toString() ?? "",
        variant.inventoryQuantity.toString(),
        variantImage,
        isFirst ? productUrl : "",
        ...(isFirst ? productImageCols : productImageCols.map(() => ""))
      ]);
    });
  }

  return [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}
