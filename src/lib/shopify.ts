const SHOPIFY_API_VERSION = "2025-10";

type ShopifyRequestConfig = {
  shopDomain: string;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
};

export async function shopifyGraphQLRequest<T>({
  shopDomain,
  accessToken,
  query,
  variables
}: ShopifyRequestConfig): Promise<T> {
  const response = await fetch(
    `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error(`Shopify GraphQL request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export type ShopInfo = { currencyCode: string | null; name: string | null };

export async function fetchShopInfo(shopDomain: string, accessToken: string): Promise<ShopInfo | null> {
  type Resp = {
    data?: { shop?: { currencyCode?: string | null; name?: string | null } | null };
    errors?: Array<{ message: string }>;
  };
  try {
    const resp = await shopifyGraphQLRequest<Resp>({
      shopDomain,
      accessToken,
      query: SHOP_INFO_QUERY
    });
    if (resp.errors?.length || !resp.data?.shop) return null;
    return {
      currencyCode: resp.data.shop.currencyCode ?? null,
      name: resp.data.shop.name ?? null
    };
  } catch {
    return null;
  }
}

export const SHOP_INFO_QUERY = `
  query ShopInfo {
    shop {
      currencyCode
      primaryDomain { url }
      name
    }
  }
`;

export const PRODUCTS_SYNC_QUERY = `
  query ProductsSync($cursor: String) {
    products(first: 100, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          handle
          title
          descriptionHtml
          status
          vendor
          productType
          tags
          updatedAt
          seo {
            title
            description
          }
          media(first: 20) {
            edges {
              node {
                id
                alt
                ... on MediaImage {
                  image {
                    url
                    altText
                  }
                }
                preview {
                  image {
                    url
                    altText
                  }
                }
              }
            }
          }
          variants(first: 50) {
            edges {
              node {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                inventoryQuantity
                updatedAt
                inventoryItem {
                  id
                }
              }
            }
          }
        }
      }
    }
  }
`;
