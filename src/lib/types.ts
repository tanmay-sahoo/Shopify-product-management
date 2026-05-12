export type StoreStatus = "active" | "inactive" | "uninstalled" | "error";

export type ProductStatus = "active" | "draft" | "archived";

export type ValidationLevel = "valid" | "warning" | "error";

export type StoreSummary = {
  id: number;
  shopDomain: string;
  displayName: string | null;
  status: StoreStatus;
  installedAt: string;
  lastSyncAt: string;
  scopes: string[];
};

export type ProductImage = {
  id: string;
  src: string;
  alt: string;
  position: number;
};

export type VariantImage = {
  id: string;
  src: string;
  position: number;
  isPrimary: boolean;
};

export type Variant = {
  id: number;
  productId: number;
  sku: string;
  title: string;
  option1Value: string;
  option2Value?: string;
  option3Value?: string;
  price: number;
  compareAtPrice?: number;
  inventoryQuantity: number;
  barcode?: string;
  status: ProductStatus;
  image?: string;
  validationLevel?: ValidationLevel;
  variantImages: VariantImage[];
  updatedAt: string;
};

export type Product = {
  id: number;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: ProductStatus;
  bodyHtml: string;
  seoTitle: string;
  seoDescription: string;
  images: ProductImage[];
  variants: Variant[];
  updatedAt: string;
  validationLevel?: ValidationLevel;
};

export type ImportRow = {
  rowNumber: number;
  handle: string;
  sku: string;
  title: string;
  price: string;
  inventory: string;
  imageColumns: string[];
  validationStatus: ValidationLevel;
  validationErrors: string[];
  actionType:
    | "create_product"
    | "update_product"
    | "create_variant"
    | "update_variant"
    | "skip";
};

export type ImportSummary = {
  id: number;
  fileName: string;
  status: "uploaded" | "processing" | "validated" | "approved" | "pushing" | "completed" | "failed";
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows: number;
  createdAt: string;
  rows: ImportRow[];
};

export type SyncLog = {
  id: number;
  jobType: string;
  status: "started" | "success" | "failed" | "partial";
  message: string;
  createdAt: string;
};

export type DraftChange = {
  id: number;
  entityType: "product" | "variant" | "image" | "inventory" | "metafield";
  changeType: "create" | "update" | "delete";
  status: "draft" | "approved" | "rejected" | "pushed" | "failed";
  summary: string;
  entityId: number | null;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  createdAt: string;
  product?: {
    id: number;
    title: string;
    handle: string;
    imageSrc: string | null;
  } | null;
  variant?: {
    id: number;
    title: string;
    sku: string;
    options: string[];
  } | null;
};

export type DashboardStats = {
  totalProducts: number;
  totalVariants: number;
  draftChanges: number;
  importErrors: number;
  imagesPending: number;
  lastSyncAt: string;
};
