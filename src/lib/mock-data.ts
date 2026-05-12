import type {
  DashboardStats,
  DraftChange,
  ImportSummary,
  Product,
  StoreSummary,
  SyncLog,
  Variant
} from "@/lib/types";

const now = "2026-05-12T11:15:00.000Z";

export const store: StoreSummary = {
  id: 1,
  shopDomain: "client-store.myshopify.com",
  displayName: null,
  status: "active",
  installedAt: "2026-05-01T09:00:00.000Z",
  lastSyncAt: now,
  scopes: [
    "read_products",
    "write_products",
    "read_inventory",
    "write_inventory",
    "read_files",
    "write_files",
    "read_locations",
    "read_metafields",
    "write_metafields"
  ]
};

export const products: Product[] = [
  {
    id: 101,
    handle: "premium-tshirt",
    title: "Premium T-Shirt",
    vendor: "Fashion Store",
    productType: "T-Shirt",
    tags: ["cotton", "summer", "core"],
    status: "active",
    bodyHtml: "<p>Soft cotton premium tee.</p>",
    seoTitle: "Premium T-Shirt",
    seoDescription: "Soft cotton premium tee for daily wear.",
    updatedAt: "2026-05-12T10:02:00.000Z",
    validationLevel: "valid",
    images: [
      {
        id: "img-1",
        src: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab",
        alt: "Black front",
        position: 1
      },
      {
        id: "img-2",
        src: "https://images.unsplash.com/photo-1503341504253-dff4815485f1",
        alt: "Black back",
        position: 2
      }
    ],
    variants: [
      {
        id: 501,
        productId: 101,
        sku: "TSH-BLK-S",
        title: "Black / S",
        option1Value: "Black",
        option2Value: "S",
        price: 19.99,
        compareAtPrice: 24.99,
        inventoryQuantity: 50,
        status: "active",
        image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab",
        variantImages: [
          {
            id: "var-1",
            src: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab",
            position: 1,
            isPrimary: true
          },
          {
            id: "var-2",
            src: "https://images.unsplash.com/photo-1503341504253-dff4815485f1",
            position: 2,
            isPrimary: false
          }
        ],
        updatedAt: "2026-05-12T10:02:00.000Z"
      },
      {
        id: 502,
        productId: 101,
        sku: "TSH-WHT-S",
        title: "White / S",
        option1Value: "White",
        option2Value: "S",
        price: 19.99,
        compareAtPrice: 24.99,
        inventoryQuantity: 18,
        status: "draft",
        validationLevel: "warning",
        image: "https://images.unsplash.com/photo-1512436991641-6745cdb1723f",
        variantImages: [
          {
            id: "var-3",
            src: "https://images.unsplash.com/photo-1512436991641-6745cdb1723f",
            position: 1,
            isPrimary: true
          }
        ],
        updatedAt: "2026-05-11T17:20:00.000Z"
      }
    ]
  },
  {
    id: 102,
    handle: "linen-overshirt",
    title: "Linen Overshirt",
    vendor: "Studio Eight",
    productType: "Shirt",
    tags: ["linen", "resort"],
    status: "draft",
    bodyHtml: "<p>Breathable linen overshirt.</p>",
    seoTitle: "Linen Overshirt",
    seoDescription: "Lightweight linen overshirt for layering.",
    updatedAt: "2026-05-10T15:44:00.000Z",
    validationLevel: "warning",
    images: [
      {
        id: "img-3",
        src: "https://images.unsplash.com/photo-1523381210434-271e8be1f52b",
        alt: "Blue linen overshirt",
        position: 1
      }
    ],
    variants: [
      {
        id: 503,
        productId: 102,
        sku: "LIN-BLU-M",
        title: "Blue / M",
        option1Value: "Blue",
        option2Value: "M",
        price: 49,
        inventoryQuantity: 7,
        barcode: "8045231001",
        status: "draft",
        validationLevel: "warning",
        image: "https://images.unsplash.com/photo-1523381210434-271e8be1f52b",
        variantImages: [
          {
            id: "var-4",
            src: "https://images.unsplash.com/photo-1523381210434-271e8be1f52b",
            position: 1,
            isPrimary: true
          }
        ],
        updatedAt: "2026-05-10T15:44:00.000Z"
      }
    ]
  }
];

export const variants: Variant[] = products.flatMap((product) => product.variants);

export const importSummary: ImportSummary = {
  id: 9001,
  fileName: "spring-catalog.xlsx",
  status: "validated",
  totalRows: 4,
  validRows: 2,
  errorRows: 1,
  warningRows: 1,
  createdAt: "2026-05-12T08:15:00.000Z",
  rows: [
    {
      rowNumber: 2,
      handle: "premium-tshirt",
      sku: "TSH-BLK-S",
      title: "Premium T-Shirt",
      price: "19.99",
      inventory: "50",
      imageColumns: [
        "https://cdn.site.com/black-front.jpg",
        "https://cdn.site.com/black-back.jpg",
        "https://cdn.site.com/black-side.jpg"
      ],
      validationStatus: "valid",
      validationErrors: [],
      actionType: "update_variant"
    },
    {
      rowNumber: 3,
      handle: "premium-tshirt",
      sku: "TSH-BLK-S",
      title: "Premium T-Shirt",
      price: "19.99",
      inventory: "60",
      imageColumns: ["not-a-url"],
      validationStatus: "error",
      validationErrors: ["Duplicate SKU found in file", "Image 1 must be a valid URL"],
      actionType: "skip"
    },
    {
      rowNumber: 4,
      handle: "linen-overshirt",
      sku: "LIN-BLU-M",
      title: "Linen Overshirt",
      price: "49.00",
      inventory: "7",
      imageColumns: ["https://cdn.site.com/linen-front.jpg"],
      validationStatus: "warning",
      validationErrors: ["Primary image reused across multiple rows"],
      actionType: "update_variant"
    },
    {
      rowNumber: 5,
      handle: "new-product",
      sku: "NEW-RED-L",
      title: "New Product",
      price: "79.00",
      inventory: "12",
      imageColumns: [
        "https://cdn.site.com/new-front.jpg",
        "https://cdn.site.com/new-detail.jpg"
      ],
      validationStatus: "valid",
      validationErrors: [],
      actionType: "create_product"
    }
  ]
};

export const syncLogs: SyncLog[] = [
  {
    id: 1,
    jobType: "shopify.initialSync",
    status: "success",
    message: "Fetched 2 products, 3 variants, and 4 media items.",
    createdAt: "2026-05-12T11:15:00.000Z"
  },
  {
    id: 2,
    jobType: "import.validateRows",
    status: "partial",
    message: "Validated 4 rows with 1 error and 1 warning.",
    createdAt: "2026-05-12T08:20:00.000Z"
  },
  {
    id: 3,
    jobType: "shopify.pushVariants",
    status: "started",
    message: "Queued 2 approved variant updates.",
    createdAt: "2026-05-12T08:25:00.000Z"
  }
];

export const draftChanges: DraftChange[] = [
  {
    id: 77,
    entityType: "variant",
    changeType: "update",
    status: "draft",
    summary: "Price update for TSH-BLK-S from $18.99 to $19.99",
    entityId: 501,
    beforeData: { price: 18.99 },
    afterData: { price: 19.99 },
    createdAt: "2026-05-12T08:10:00.000Z"
  },
  {
    id: 78,
    entityType: "image",
    changeType: "create",
    status: "approved",
    summary: "Attach 3 variant images to Linen Overshirt / Blue / M",
    entityId: 503,
    beforeData: null,
    afterData: { imagesAttached: 3 },
    createdAt: "2026-05-12T08:22:00.000Z"
  }
];

export const dashboardStats: DashboardStats = {
  totalProducts: products.length,
  totalVariants: variants.length,
  draftChanges: draftChanges.length,
  importErrors: importSummary.errorRows,
  imagesPending: 6,
  lastSyncAt: now
};
