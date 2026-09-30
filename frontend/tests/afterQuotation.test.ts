// After Quotation (v1.321): what the operator types becomes the exact sizes and
// chart the backend writes to Shopify. Plus a source-level wiring guard for the
// page (a JSX component can't be imported by these node tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normSize,
  parseSizeList,
  sortSizes,
  parseChartText,
  chartSizes,
  sizesMatchChart,
  chartForSizes,
  targetFingerprint,
} from "../lib/afterQuotation";

test("sizes: one spelling, smallest first", () => {
  assert.equal(normSize("xxl"), "2XL");
  assert.equal(normSize("EU 38"), "38");
  assert.equal(normSize("Taille unique"), "One Size");
  assert.deepEqual(sortSizes(["XL", "s", "xxl", "M"]), ["S", "M", "XL", "2XL"]);
});

test("size lists understand ranges the way suppliers write them", () => {
  assert.deepEqual(parseSizeList("S-2XL"), ["S", "M", "L", "XL", "2XL"]);
  assert.deepEqual(parseSizeList("35–41"), ["35", "36", "37", "38", "39", "40", "41"]);
  assert.deepEqual(parseSizeList("36-46/2"), ["36", "38", "40", "42", "44", "46"]);
  assert.deepEqual(parseSizeList("S, M, L, XXL"), ["S", "M", "L", "2XL"]);
  assert.deepEqual(parseSizeList("S M L XL"), ["S", "M", "L", "XL"]);
  assert.deepEqual(parseSizeList("one size"), ["One Size"]);
  assert.deepEqual(parseSizeList("EU 35 - 38"), ["35", "36", "37", "38"]);
  assert.deepEqual(parseSizeList("Str. S/M/L"), ["S", "M", "L"]);
  assert.deepEqual(parseSizeList("Sizes: XS - XL"), ["XS", "S", "M", "L", "XL"]);
  assert.deepEqual(parseSizeList(""), []);
});

test("size edge cases the review found (2026-09-29)", () => {
  assert.deepEqual(parseSizeList("36, 36,5, 37"), ["36", "36.5", "37"]);
  assert.deepEqual(parseSizeList("36,38,40"), ["36", "38", "40"]);
  assert.deepEqual(parseSizeList("Taille unique"), ["One Size"]);
  assert.deepEqual(parseSizeList("One size fits all"), ["One Size"]);
  assert.deepEqual(parseSizeList("S to 2XL"), ["S", "M", "L", "XL", "2XL"]);
  assert.deepEqual(parseSizeList("EU36-EU42"), ["36", "37", "38", "39", "40", "41", "42"]);
  assert.deepEqual(parseSizeList("S/M L/XL"), ["S/M", "L/XL"]); // combined sizes stay one size each
});

test("a chart pasted from Excel keeps its header and rows", () => {
  const c = parseChartText("Size\tBust\tLength\nS\t86\t120\nM\t90\t122\n");
  assert.deepEqual(c, { headers: ["Size", "Bust", "Length"], rows: [["S", "86", "120"], ["M", "90", "122"]] });
  const noHeader = parseChartText("35;22.1\n36;22.8");
  assert.deepEqual(noHeader?.headers, []);
  assert.equal(parseChartText("just one line"), null);
  // CSV: one separator for the whole paste
  assert.deepEqual(parseChartText("Size,Bust,Length\nS,86,120\nM,90,122")?.rows, [["S", "86", "120"], ["M", "90", "122"]]);
  // two-space columns keep "Bust (cm)" in one piece
  assert.deepEqual(parseChartText("Size   Bust (cm)\nS      86")?.headers, ["Size", "Bust (cm)"]);
  // transposed shoe chart: the label row is the header
  const shoe = parseChartText("EU\t35\t36\t37\nFoot length\t22.1\t22.8\t23.4");
  assert.deepEqual(shoe?.headers, ["EU", "35", "36", "37"]);
  assert.deepEqual(chartSizes(shoe), ["35", "36", "37"]);
});

test("chart sizes and the size check mirror the backend", () => {
  const chart = { headers: ["EU", "cm"], rows: [["35", "22"], ["36", "23"]] };
  assert.deepEqual(chartSizes(chart), ["35", "36"]);
  assert.equal(sizesMatchChart(["35", "36"], chart), true);
  assert.equal(sizesMatchChart(["35"], chart), false);
  assert.equal(sizesMatchChart(["S", "M"], chart), null); // conversion table, not a contradiction
  assert.deepEqual(chartForSizes(["S", "M"], ["Size", "Bust (cm)"]).rows, [["S", ""], ["M", ""]]);
  // "one row per size" keeps the measurements already typed
  const kept = chartForSizes(["S", "M", "L"], ["Size", "Bust"], { headers: ["Size", "Bust"], rows: [["M", "90"]] });
  assert.deepEqual(kept.rows, [["S", ""], ["M", "90"], ["L", ""]]);
});

test("the preview fingerprint notices a swapped photo without hashing the bytes", () => {
  const photo = (tail: string) => "data:image/jpeg;base64," + "Q".repeat(4000) + tail;
  const a = targetFingerprint({ photos: [{ images: [photo("AAAA1111")] }] });
  const same = targetFingerprint({ photos: [{ images: [photo("AAAA1111")] }] });
  const swapped = targetFingerprint({ photos: [{ images: [photo("BBBB2222")] }] });
  assert.equal(a, same);
  assert.notEqual(a, swapped);
  assert.ok(a.length < 200); // never the data itself
});

const root = join(__dirname, "..", "..");
const wb = readFileSync(join(root, "components", "after-quotation", "AfterQuotationWorkbench.tsx"), "utf8");
const api = readFileSync(join(root, "lib", "api.ts"), "utf8");
const header = readFileSync(join(root, "components", "Header.tsx"), "utf8");

test("every After Quotation call is authed (supplier data + Shopify writes)", () => {
  const block = api.slice(api.indexOf("export const aqApi"));
  const calls = block.match(/call</g) ?? [];
  const authed = block.match(/authed: true/g) ?? [];
  assert.ok(calls.length >= 8);
  assert.equal(authed.length, calls.length);
});

test("apply only runs on a fresh preview, and undo is offered", () => {
  assert.match(wb, /planFingerprint === currentFingerprint/);
  // the listing's signature from the preview travels with the apply
  assert.match(wb, /aqApi\.apply\(family\.key, buildTarget\(true\), plan\.sig\)/);
  assert.match(api, /body: \{ key, target, sig \}/);
  assert.match(wb, /aqApi\.undo\(/);
  assert.match(header, /window\.open\("\/after-quotation", "_blank"\)/);
});

test("review 2026-09-29: answers land only on the listing that asked, photos clear only after a write", () => {
  // every slow call checks it is still on the same listing before touching the form
  assert.ok((wb.match(/if \(!stillOn\(key\)\) return;/g) ?? []).length >= 3);
  assert.match(wb, /activeKey\.current = key;/);
  // one-shot photos/new colours are cleared only when the job actually wrote
  assert.match(wb, /done\.status === "done" \|\| done\.status === "partial"\) && stillOn\(key\)/);
  // a colour missing from the quote is marked, never pre-hidden
  assert.doesNotMatch(wb, /action: x\.confidence === "high" \? "drop"/);
  assert.match(wb, /acts\[r\.row_id\] = \{ action: "keep", labels: \{\}, notInQuote: true \}/);
  // flagged copy starts unticked; undo only on the newest change
  assert.match(wb, /c\.after !== c\.before && !c\.warnings\.length/);
  assert.match(wb, /newestUndoable\?\.backup_id === h\.backup_id/);
  // the list is locked while Shopify is written
  assert.match(wb, /disabled=\{jobRunning && !on\}/);
});

import { deaccent, filterFamilies, isServerQuery, orderBadge, type AqListEntry } from "../lib/afterQuotation";

const entry = (over: Partial<AqListEntry>): AqListEntry => ({
  key: over.name ?? "k", name: "X", cat: "dress", type: "Dress", image: "", created: "2026-09-01T00:00:00Z",
  stores: { dk: 1 }, active: 1, total: 1, sizes: ["S"], colours: [], flags: [], processed: null, orders: null,
  rec: null, att: false, names: [deaccent(over.name ?? "x")], hay: "", ...over,
});

test("deaccent matches the server's (Nordic letters before NFKD)", () => {
  assert.equal(deaccent("Mørkegrøn"), "morkegron");
  assert.equal(deaccent("Zoé"), "zoe");
  assert.equal(deaccent("Blåbær Æble"), "blabaer aeble");
});

test("recommended: newest certain first order on top, then uncertain, then attention", () => {
  const list = [
    entry({ name: "Frisk", rec: [1, "2026-09-25T00:00:00Z"] }),
    entry({ name: "Gamle", rec: [2, "2026-09-29T00:00:00Z"] }),
    entry({ name: "Runa", rec: [3, "2026-09-26T00:00:00Z"] }),
    entry({ name: "Ottilie", rec: [3, "2026-09-29T00:00:00Z"] }),
    entry({ name: "Nope", rec: null }),
  ];
  assert.deepEqual(filterFamilies(list, "", "recommended").map((e) => e.name), ["Ottilie", "Runa", "Gamle", "Frisk"]);
});

test("typing filters every listing with the server's scoring", () => {
  const list = [
    entry({ name: "Runa", created: "2026-09-02T00:00:00Z" }),
    entry({ name: "Brunella", created: "2026-09-03T00:00:00Z" }),
    entry({ name: "Ottilie", hay: "sort ottilie-sort" }),
  ];
  assert.deepEqual(filterFamilies(list, "run", "recommended").map((e) => e.name), ["Runa", "Brunella"]);
  // accents/case don't matter, and a query searches every listing whatever the pill
  assert.deepEqual(filterFamilies(list, "SØRT", "done").map((e) => e.name), ["Ottilie"]);
  assert.deepEqual(filterFamilies(list, "xyz", "recommended").map((e) => e.name), []);
});

test("links, ids and competitor URLs go to the server", () => {
  assert.equal(isServerQuery("https://admin.shopify.com/store/x/products/123"), true);
  assert.equal(isServerQuery("16554287137117"), true);
  assert.equal(isServerQuery("chic-parisien.fr/products/dejana"), true);
  assert.equal(isServerQuery("carina"), false);
  assert.equal(isServerQuery("mørk khaki"), false);
});

test("order badge says when the first order is not certain", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  assert.equal(orderBadge({ first: "2026-09-29T08:00:00Z", last: "2026-09-29T08:00:00Z", count: 1, first_known: true }, now), "1st order yesterday · 1 order");
  assert.match(orderBadge({ first: "2026-09-01T08:00:00Z", last: "2026-09-27T08:00:00Z", count: 3, first_known: false }, now) ?? "", /ordered 3 days ago · 3 orders \(earlier orders unknown\)/);
  assert.equal(orderBadge(null, now), null);
});

test("order badge counts calendar days, not 24-hour blocks (review 30 Sep)", () => {
  const now = new Date(2026, 8, 30, 8, 0); // 30 Sep 08:00 local
  const at = (d: number, h: number) => new Date(2026, 8, d, h, 0).toISOString();
  assert.equal(orderBadge({ first: at(29, 22), last: at(29, 22), count: 1, first_known: true }, now), "1st order yesterday · 1 order");
  assert.equal(orderBadge({ first: at(30, 1), last: at(30, 1), count: 1, first_known: true }, now), "1st order today · 1 order");
  assert.equal(orderBadge({ first: at(28, 21), last: at(28, 21), count: 1, first_known: true }, now), "1st order 2 days ago · 1 order");
});
