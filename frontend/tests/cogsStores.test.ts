import { test } from "node:test";
import assert from "node:assert/strict";

import { StoreRow, sortProducts, storeLabel, storeSummaries } from "../lib/cogsStores";

// Shaped after a real report: 5 stores, DK in DKK and the rest in EUR, DK/FR
// carrying an estimate because those run through Fillbox.
const row = (
  store: string,
  pct: number,
  extra: Partial<StoreRow> = {}
): StoreRow => ({
  store,
  pct,
  over: pct > 40,
  cost: 10,
  price: 100,
  currency: store === "dk" ? "DKK" : "EUR",
  title: `${store}-${pct}`,
  ...extra,
});

test("stores are listed worst first", () => {
  const rows = [
    row("nl", 20),
    row("nl", 55),
    row("nl", 60),
    row("de", 70),
    row("fi", 30),
  ];
  const s = storeSummaries(rows);
  assert.deepEqual(
    s.map((x) => [x.store, x.over, x.total]),
    [
      ["nl", 2, 3],
      ["de", 1, 1],
      ["fi", 0, 1],
    ]
  );
});

test("a store with a supplier quote but nothing judgeable still gets a row", () => {
  // Silence must not read as approval: this is the case where a cost came in
  // but no current price could be matched.
  const s = storeSummaries([row("nl", 55)], ["nl", "de"]);
  const de = s.find((x) => x.store === "de");
  assert.ok(de, "the store must not disappear just because it has no products");
  assert.equal(de.total, 0);
  assert.equal(de.over, 0);
  assert.equal(de.hasMeasuredCost, true);
  assert.equal(de.currency, null);
});

test("a store whose figures are all estimated is flagged as such", () => {
  const s = storeSummaries([
    row("dk", 84, { estimated: true }),
    row("fr", 50, { estimated: true }),
    row("fi", 45),
  ]);
  assert.equal(s.find((x) => x.store === "dk")!.allEstimated, true);
  assert.equal(s.find((x) => x.store === "fi")!.allEstimated, false);
});

test("one measured row is enough to stop calling a store estimated", () => {
  const s = storeSummaries([
    row("dk", 84, { estimated: true }),
    row("dk", 50),
  ]);
  assert.equal(s[0].allEstimated, false);
});

test("each store reports its own currency", () => {
  const s = storeSummaries([row("dk", 84), row("fi", 45)]);
  assert.equal(s.find((x) => x.store === "dk")!.currency, "DKK");
  assert.equal(s.find((x) => x.store === "fi")!.currency, "EUR");
});

test("a store with two currencies is surfaced, not silently picked", () => {
  const s = storeSummaries([
    row("nl", 50, { currency: "EUR" }),
    row("nl", 60, { currency: "USD" }),
  ]);
  assert.equal(s[0].mixedCurrency, true);
  assert.equal(s[0].currency, null, "no currency may be presented as the truth here");
});

test("an unknown store key is shown, never dropped", () => {
  // A new store must appear in the tabs the day it starts selling, even before
  // anyone adds a display name for it.
  assert.equal(storeLabel("se"), "SE");
  const s = storeSummaries([row("se", 55)]);
  assert.equal(s.length, 1);
  assert.equal(s[0].label, "SE");
});

test("known stores get their brand name", () => {
  assert.equal(storeLabel("dk"), "Vionna DK");
  assert.equal(storeLabel("nl"), "Light Supplier NL");
});

test("sorting on percentage puts the worst on top", () => {
  const rows = [row("nl", 30), row("nl", 90), row("nl", 55)];
  assert.deepEqual(
    sortProducts(rows, "pct", "desc").map((r) => r.pct),
    [90, 55, 30]
  );
  assert.deepEqual(
    sortProducts(rows, "pct", "asc").map((r) => r.pct),
    [30, 55, 90]
  );
});

test("sorting never mutates the list it was given", () => {
  const rows = [row("nl", 30), row("nl", 90)];
  sortProducts(rows, "pct", "desc");
  assert.deepEqual(rows.map((r) => r.pct), [30, 90]);
});

test("equal values keep a stable order instead of reshuffling", () => {
  const rows = [
    row("nl", 50, { title: "Zoe" }),
    row("nl", 50, { title: "Anna" }),
    row("nl", 50, { title: "Maja" }),
  ];
  const once = sortProducts(rows, "pct", "desc").map((r) => r.title);
  const twice = sortProducts(sortProducts(rows, "pct", "desc"), "pct", "desc").map(
    (r) => r.title
  );
  assert.deepEqual(once, ["Anna", "Maja", "Zoe"]);
  assert.deepEqual(twice, once);
});

test("sorting by name uses the Shopify title when there is one", () => {
  const rows = [
    row("nl", 50, { title: "aaa", shopify_title: "Zeta" }),
    row("nl", 50, { title: "zzz", shopify_title: "Alpha" }),
  ];
  assert.deepEqual(
    sortProducts(rows, "title", "asc").map((r) => r.shopify_title),
    ["Alpha", "Zeta"]
  );
});

test("a missing sold-count sorts as zero rather than throwing", () => {
  const rows = [row("nl", 50, { seen: 3 }), row("nl", 60)];
  assert.deepEqual(
    sortProducts(rows, "seen", "desc").map((r) => r.seen ?? 0),
    [3, 0]
  );
});
