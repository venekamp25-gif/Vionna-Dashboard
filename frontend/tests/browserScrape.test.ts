import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productJsonUrl,
  looksLikeShopifyProductJson,
  fetchProductJsonFromBrowser,
} from "../lib/browserScrape";

const PRODUCT = JSON.stringify({
  product: { title: "Glow", options: [{ name: "Color", values: ["Black"] }], variants: [{ price: "49.00" }] },
});

function fakeFetch(
  handler: (url: string, init?: RequestInit) => Promise<Partial<Response>> | Partial<Response>
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return (await handler(url, init)) as Response;
  }) as typeof fetch;
}

function okResponse(body: string, extra: Partial<Response> = {}): Partial<Response> {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => body,
    ...extra,
  };
}

test("productJsonUrl: tracking query and fragment dropped, .json appended", () => {
  assert.equal(
    productJsonUrl("https://aorabrand.co/products/glow?variant=50518780707028#x"),
    "https://aorabrand.co/products/glow.json"
  );
});

test("productJsonUrl: collection prefix removed, trailing slash and existing .json handled, locale kept", () => {
  assert.equal(productJsonUrl("https://shop.com/collections/lamps/products/aora/"), "https://shop.com/products/aora.json");
  assert.equal(productJsonUrl("https://shop.com/products/aora.json"), "https://shop.com/products/aora.json");
  assert.equal(productJsonUrl("https://shop.com/en-us/products/aora"), "https://shop.com/en-us/products/aora.json");
});

test("productJsonUrl: not a product URL → null", () => {
  assert.equal(productJsonUrl("https://shop.com/collections/lamps"), null);
  assert.equal(productJsonUrl("ftp://shop.com/products/aora"), null);
  assert.equal(productJsonUrl("aora"), null);
  assert.equal(productJsonUrl(""), null);
});

test("looksLikeShopifyProductJson: wrapped and bare shapes pass, prose and HTML fail", () => {
  assert.equal(looksLikeShopifyProductJson(PRODUCT), true);
  assert.equal(looksLikeShopifyProductJson(JSON.stringify({ variants: [] })), true);
  assert.equal(looksLikeShopifyProductJson("<html>Just a moment…</html>"), false);
  assert.equal(looksLikeShopifyProductJson(JSON.stringify({ errors: "Not Found" })), false);
});

test("fetch: a 200 with product JSON comes back ok, fetched cross-origin without cookies", async () => {
  let seen: { url: string; init?: RequestInit } | null = null;
  const r = await fetchProductJsonFromBrowser("https://aorabrand.co/products/glow?variant=1", {
    fetchImpl: fakeFetch((url, init) => {
      seen = { url, init };
      return okResponse(PRODUCT);
    }),
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.json, PRODUCT);
  assert.equal(seen!.url, "https://aorabrand.co/products/glow.json");
  assert.equal(seen!.init?.mode, "cors");
  assert.equal(seen!.init?.credentials, "omit");
});

test("fetch: the shop rate-limiting the browser too is reported, not thrown", async () => {
  const r = await fetchProductJsonFromBrowser("https://shop.com/products/x", {
    fetchImpl: fakeFetch(() => ({ ok: false, status: 429, headers: new Headers(), text: async () => "" })),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /429/);
});

test("fetch: a bot-check HTML page is not accepted as a product", async () => {
  const r = await fetchProductJsonFromBrowser("https://shop.com/products/x", {
    fetchImpl: fakeFetch(() => okResponse("<html>Checking your browser…</html>")),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /not a Shopify product JSON/);
});

test("fetch: a network / CORS failure is reported with the browser's message", async () => {
  const r = await fetchProductJsonFromBrowser("https://shop.com/products/x", {
    fetchImpl: fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    }),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /Failed to fetch/);
});

test("fetch: an oversized answer is refused", async () => {
  const r = await fetchProductJsonFromBrowser("https://shop.com/products/x", {
    fetchImpl: fakeFetch(() => okResponse("x".repeat(10), { headers: new Headers({ "content-length": "9000000" }) })),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /too large/);
});

test("fetch: a hung request gives up after the timeout", async () => {
  const r = await fetchProductJsonFromBrowser("https://shop.com/products/x", {
    timeoutMs: 20,
    fetchImpl: fakeFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    ),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /no answer within/);
});

test("fetch: a non-product URL never hits the network", async () => {
  let called = false;
  const r = await fetchProductJsonFromBrowser("https://shop.com/collections/all", {
    fetchImpl: fakeFetch(() => {
      called = true;
      return okResponse(PRODUCT);
    }),
  });
  assert.equal(r.ok, false);
  assert.equal(called, false);
});
