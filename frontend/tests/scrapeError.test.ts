import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyScrapeError, isShopRefusal } from "../lib/scrapeError";

test("a rate-limited or anti-bot shop is a refusal: the browser route may run", () => {
  assert.equal(isShopRefusal("This shop is rate-limiting our server (HTTP 429 — too many requests). Try again in a few minutes."), true);
  assert.equal(isShopRefusal("This shop's anti-bot protection (Cloudflare or similar) is blocking our scraper."), true);
  assert.equal(isShopRefusal("Upstream returned 403. The shop may be private, geo-restricted, or temporarily blocking us."), true);
  assert.equal(isShopRefusal("API /api/scrape → 429: {\"error\": \"rate limited\"}"), true);
});

test("a dashboard hiccup is NOT a refusal: never tell the worker the shop blocks us", () => {
  assert.equal(isShopRefusal("API /api/scrape → 502: "), false);
  assert.equal(isShopRefusal("API /api/scrape → 504: <html>Gateway Timeout</html>"), false);
  assert.equal(isShopRefusal("Failed to fetch"), false);
  assert.equal(isShopRefusal("Upstream timed out while blocking on the read."), false);
  assert.equal(isShopRefusal("That product URL does not exist."), false);
  assert.equal(isShopRefusal(null), false);
});

test("classifyScrapeError keeps its old shape for the paste offer", () => {
  assert.equal(classifyScrapeError("This shop is rate-limiting our server (HTTP 429)."), "rate-limit");
  assert.equal(classifyScrapeError("API /api/scrape → 502: "), "block");
  assert.equal(classifyScrapeError("That product URL does not exist."), "other");
});
