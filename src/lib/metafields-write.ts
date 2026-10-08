// Writes metafields through metafieldsSet, which has two properties that
// together make the naive loop lose data:
//
//  1. It accepts at most 25 metafields per call.
//  2. It is atomic — "no changes are persisted if an error is encountered".
//     One rejected entry means NOTHING in that call is written, not even the
//     valid siblings.
//
// So when a call comes back with userErrors we drop exactly the entries Shopify
// named (its `field` path carries their index) and retry once with the rest.
// Without that retry a single bad metafield — an over-long list, a type
// mismatch, an owner-subtype clash — silently takes up to 24 good ones with it.

import { shopifyGraphQLRequest } from "@/lib/shopify";

export type MetafieldSetInput = {
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
};

export type MetafieldWriteResult = {
  set: number;
  failed: number;
  // Deduped, human-readable failures: "custom.printer_number: Value has more
  // than 128 elements." — the namespace.key rather than the batch index, which
  // is meaningless to whoever reads the import report.
  messages: string[];
};

const METAFIELDS_SET = `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

type MetafieldsSetResponse = {
  data?: { metafieldsSet?: { userErrors?: Array<{ field: string[] | null; message: string }> } };
  errors?: Array<{ message: string }>;
};

/** `["metafields", "7", "value"]` → 7. Null when the path carries no index. */
function indexFromFieldPath(field: string[] | null | undefined): number | null {
  for (const part of field ?? []) {
    if (/^\d+$/.test(part)) return Number(part);
  }
  return null;
}

function describe(input: MetafieldSetInput | undefined, field: string[] | null | undefined): string {
  if (input) return `${input.namespace}.${input.key}`;
  const path = (field ?? []).join(".");
  return path || "metafield";
}

export async function writeMetafields(
  auth: { shopDomain: string; accessToken: string },
  inputs: MetafieldSetInput[]
): Promise<MetafieldWriteResult> {
  const result: MetafieldWriteResult = { set: 0, failed: 0, messages: [] };
  const addMessage = (message: string) => {
    if (!result.messages.includes(message)) result.messages.push(message);
  };

  const send = (metafields: MetafieldSetInput[]) =>
    shopifyGraphQLRequest<MetafieldsSetResponse>({
      shopDomain: auth.shopDomain,
      accessToken: auth.accessToken,
      query: METAFIELDS_SET,
      variables: { metafields }
    });

  for (let i = 0; i < inputs.length; i += 25) {
    const slice = inputs.slice(i, i + 25);
    const resp = await send(slice);

    const topErrors = resp.errors?.map((e) => e.message) ?? [];
    if (topErrors.length > 0) {
      // Transport/throttle level — the call never ran, so nothing was written.
      result.failed += slice.length;
      for (const m of topErrors) addMessage(m);
      continue;
    }

    const userErrors = resp.data?.metafieldsSet?.userErrors ?? [];
    if (userErrors.length === 0) {
      result.set += slice.length;
      continue;
    }

    // Atomic failure: this whole call persisted nothing. Work out which entries
    // Shopify objected to.
    const rejected = new Set<number>();
    for (const e of userErrors) {
      const index = indexFromFieldPath(e.field);
      if (index !== null && index >= 0 && index < slice.length) rejected.add(index);
      addMessage(`${describe(index === null ? undefined : slice[index], e.field)}: ${e.message}`);
    }

    if (rejected.size === 0 || rejected.size === slice.length) {
      // Either Shopify didn't say which entry was at fault, or every entry was.
      // Nothing can be salvaged by retrying.
      result.failed += slice.length;
      continue;
    }

    const retry = slice.filter((_, index) => !rejected.has(index));
    const retryResp = await send(retry);
    const retryErrors = [
      ...(retryResp.errors?.map((e) => e.message) ?? []),
      ...(retryResp.data?.metafieldsSet?.userErrors ?? []).map((e, idx) => {
        const index = indexFromFieldPath(e.field);
        return `${describe(retry[index ?? idx], e.field)}: ${e.message}`;
      })
    ];
    if (retryErrors.length === 0) {
      result.set += retry.length;
      result.failed += rejected.size;
    } else {
      // The retry failed too — again atomic, so none of `retry` landed either.
      result.failed += slice.length;
      for (const m of retryErrors) addMessage(m);
    }
  }

  return result;
}
