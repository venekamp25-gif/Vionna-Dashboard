// Competitor sizes at listing (v1.323). Cases are real values from the survey
// of 9,406 competitor products (30 Sep 2026). backend/tests/test_listing_sizes.py
// runs the SAME table through the server twin — keep them identical.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { competitorSizes, findSizeOption, normCompetitorSize, sizeRegion } from "../lib/competitorSizes";
import { normSize, parseSizeList, sortSizes } from "../lib/afterQuotation";

type Case = [string, string, string[], string[], string, string];
// [option name, category, competitor values, expected sizes, expected source, competitor host]
export const CASES: Case[] = [
  ["Pointure", "shoes", ["35", "36", "37", "38", "39", "40", "41", "42", "43"], ["35", "36", "37", "38", "39", "40", "41", "42", "43"], "competitor", ""],
  ["Maat", "garment", ["S (36)", "M (38)", "L (40/42)", "XL (44)", "2XL (46)", "3XL (48)"], ["S", "M", "L", "XL", "2XL", "3XL"], "competitor", ""],
  ["Size", "garment", ["6", "8", "10", "12", "14", "16", "18"], ["XS", "S", "M", "L", "XL", "2XL", "3XL"], "converted-uk", "goddiva.co.uk"],
  ["Size", "garment", ["16", "18", "20", "22", "24", "26"], ["2XL", "3XL", "4XL", "5XL", "6XL", "7XL"], "converted-uk", "goddiva.co.uk"],
  ["Size", "garment", ["4", "6", "8", "10", "12", "14", "16", "18"], ["XS", "S", "M", "L", "XL"], "default", "tp-kjoler.dk"],
  ["Size", "shoes", ["5", "6", "7", "8", "9", "10"], ["38", "39", "40", "41", "42", "43"], "converted-uk", "www.meshki.co.uk"],
  ["Size", "shoes", ["5", "6", "7", "8", "9", "10"], ["36", "37", "38", "39", "40", "41"], "converted-uk", "billyj.com.au"],
  ["Size", "shoes", ["5", "6", "7", "8"], ["36", "37", "38", "39", "40", "41"], "shoe-default", "zentaro.nl"],
  ["Size", "shoes", ["3", "3.5", "4", "4.5", "5"], ["36", "37", "38", "39", "40", "41"], "shoe-default", "www.meshki.co.uk"],
  ["SIZE", "garment", ["4", "6", "7", "8", "9", "10", "11"], ["XS", "S", "M", "L", "XL"], "default", ""],
  ["Koko", "garment", ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"], ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"], "competitor", ""],
  ["Koko", "garment", ["32", "34", "36", "38", "40", "42", "44", "Lady S (46)", "Lady M (48)", "Lady L (50)", "Lady XL (52)", "Lady XXL (54)"], ["32", "34", "36", "38", "40", "42", "44", "46", "48", "50", "52", "54"], "competitor", "briima.fi"],
  ["Size", "garment", ["S(US 6-8)", "M(US 10-12)", "L(US 14-16)", "XL(US 18)", "2XL(US 20)", "5XL(US 22)"], ["S", "M", "L", "XL", "2XL", "5XL"], "competitor", "zentaro.nl"],
  ["Maat", "garment", ["XS 32/34", "S 36/38", "M 38/40", "L 40/42", "XL 42/44", "XXL 42/44", "3XL 44/46"], ["XS", "S", "M", "L", "XL", "2XL", "3XL"], "competitor", "zentaro.nl"],
  ["Size", "garment", ["0XL", "1XL", "2XL", "3XL"], ["0XL", "1XL", "2XL", "3XL"], "competitor", ""],
  ["Size", "garment", ["XXXS", "XXS", "XS", "S"], ["3XS", "XXS", "XS", "S"], "competitor", ""],
  ["Størrelse", "garment", ["Lille", "Medium", "Stor"], ["S", "M", "L"], "competitor", ""],
  ["Size", "garment", ["36-38", "39-41"], ["36-38", "39-41"], "competitor", "famme.fi"],
  ["Pointure", "shoes", ["S", "M", "L"], ["S", "M", "L"], "competitor", ""],
  ["Size", "garment", ["One Size", "One Size Plus"], ["One Size"], "competitor", ""],
  ["Taille", "garment", ["Taille unique"], ["One Size"], "competitor", ""],
  ["Taille", "garment", ["S", "M (presque épuisé)", "L Quasi épuisé"], ["S", "M", "L"], "competitor", ""],
  ["Größe", "shoes", ["UK 2 | EU 35", "35.5", "36", "UK 6 | EU 39", "39.5"], ["35", "35.5", "36", "39", "39.5"], "competitor", ""],
  ["Taille", "garment", ["M", "S", "XL", "L'", "XXL"], ["S", "M", "L", "XL", "2XL"], "competitor", ""],
  ["Size", "garment", ["S/M", "L/XL", "XS", "2XL/3XL"], ["XS", "S/M", "L/XL", "2XL/3XL"], "competitor", ""],
  ["Taille", "garment", ["36.0", "38.0", "40.0"], ["36", "38", "40"], "competitor", ""],
  ["Size", "accessory", ["XS", "S", "M"], ["One Size"], "one-size", ""],
  ["Color", "garment", ["Black", "White"], ["XS", "S", "M", "L", "XL"], "default", ""],
  ["Color", "shoes", ["Black"], ["36", "37", "38", "39", "40", "41"], "shoe-default", ""],
  ["Forstørrelse", "garment", ["+1.00", "+2.50"], ["XS", "S", "M", "L", "XL"], "default", ""],
  ["Größe", "garment", ["Einheitsgröße"], ["One Size"], "competitor", ""],
  ["Taille", "garment", ["XS", "S", "M", "L", "XL"], ["XS", "S", "M", "L", "XL"], "competitor", ""],
];

test("real competitor size lists become the listing's sizes", () => {
  for (const [name, cat, values, sizes, source, host] of CASES) {
    const r = competitorSizes([{ name: "Couleur", values: ["Noir", "Blanc"] }, { name, values }], cat, host);
    assert.deepEqual(r.sizes, sizes, `${name} ${JSON.stringify(values)}`);
    assert.equal(r.source, source, `${name} ${JSON.stringify(values)}`);
  }
});

test("the table is the same one the server twin runs", () => {
  const py = readFileSync(join(__dirname, "..", "..", "..", "backend", "tests", "test_listing_sizes.py"), "utf8");
  for (const [name, , values, , source, host] of CASES) {
    assert.ok(py.includes(`'${source}', '${host}')`) && py.includes(values[0].replace(/'/g, "\\'")), `${name} missing in the Python table`);
  }
});

test("conversions and fallbacks explain themselves; the competitor's values are kept", () => {
  const uk = competitorSizes([{ name: "Size", values: ["6", "8", "10"] }], "garment", "goddiva.co.uk");
  assert.match(uk.note ?? "", /UK\/AU/);
  assert.deepEqual(uk.raw, ["6", "8", "10"]);
  assert.match(competitorSizes([{ name: "Size", values: ["6", "8", "10"] }], "garment", "shop.dk").note ?? "", /UK or US/);
  assert.match(competitorSizes([{ name: "Size", values: ["5", "6"] }], "shoes", "billyj.com.au").note ?? "", /AU shoe/);
  const none = competitorSizes([{ name: "Couleur", values: ["Noir"] }], "garment");
  assert.match(none.note ?? "", /lists no sizes/);
  assert.equal(competitorSizes([{ name: "Size", values: ["M"] }], "garment").note, "The competitor sells only one size");
  assert.match(competitorSizes([{ name: "Size", values: ["One Size", "One Size Plus"] }], "garment").note ?? "", /One Size Plus/);
});

test("only sizes the competitor really sells can be restored", () => {
  const real = competitorSizes([{ name: "Taille", values: ["S", "M", "L"] }], "garment");
  assert.deepEqual([real.restore, real.restoreSource], [["S", "M", "L"], "competitor"]);
  const made = competitorSizes([{ name: "Couleur", values: ["Noir"] }], "garment");
  assert.deepEqual([made.restore, made.restoreSource], [[], null]);
  const shoe = competitorSizes([{ name: "Couleur", values: ["Noir"] }], "shoes");
  assert.deepEqual(shoe.restore, []);
  // a garment the title took for an accessory: One Size, the real sizes one click away
  const acc = competitorSizes([{ name: "Taille", values: ["S", "M", "L"] }], "accessory");
  assert.deepEqual([acc.sizes, acc.restore, acc.restoreSource], [["One Size"], ["S", "M", "L"], "competitor"]);
  assert.match(acc.note ?? "", /S M L/);
  assert.equal(competitorSizes([{ name: "Taille", values: ["One Size"] }], "accessory").note, undefined);
});

test("UK, US or AU: bare numbers follow the shop, not a guess", () => {
  assert.equal(sizeRegion("goddiva.co.uk", "Size", ["8"]), "uk");
  assert.equal(sizeRegion("billyj.com.au", "Size", ["8"]), "au");
  assert.equal(sizeRegion("shop.dk", "US Size", ["8"]), "us");
  assert.equal(sizeRegion("zentaro.nl", "Size", ["8"]), null);
});

test("the size option is found by name in any language, or by its values", () => {
  assert.equal(findSizeOption([{ name: "Väri", values: ["S", "M", "L"] }])?.name, "Väri"); // colour-named, holds sizes
  assert.equal(findSizeOption([{ name: "Antal", values: ["1", "2", "3"] }]), null);
  assert.equal(findSizeOption([{ name: "Title", values: ["Default Title"] }]), null);
  assert.equal(normCompetitorSize("The term \"2XL\" is typically used for"), null);
  assert.equal(normCompetitorSize("36/80BC"), null);
});

test("the After Quotation normaliser speaks the same size vocabulary", () => {
  assert.equal(normSize("36.0"), "36");
  assert.equal(normSize("37½"), "37.5");
  assert.equal(normSize("OSFA"), "One Size");
  assert.equal(normSize("2XS"), "XXS");
  assert.equal(normSize("6XL"), "6XL");
  assert.deepEqual(sortSizes(["L/XL", "XS", "S/M"]), ["XS", "S/M", "L/XL"]);
  // 1XL is its own size; a range walks the plus scale only when it starts or ends on it
  assert.equal(normSize("1XL"), "1XL");
  assert.equal(normSize("XXXS"), "3XS");
  assert.deepEqual(parseSizeList("S-2XL"), ["S", "M", "L", "XL", "2XL"]);
  assert.deepEqual(parseSizeList("0XL-3XL"), ["0XL", "1XL", "2XL", "3XL"]);
  assert.deepEqual(parseSizeList("XL/2XL"), ["XL/2XL"]);
});

const root = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

test("the import always writes sizes, a new product never inherits the last one's", () => {
  const gen = read("components", "steps", "GenerateStep.tsx");
  assert.match(gen, /const sizes = competitorSizes\(product\?\.options, nbCategory\(productType\), safeHostname\(data\.competitorUrl\)\)/);
  assert.match(gen, /competitorSizes: sizes\.restore,\s*\n\s*competitorSizesSource: sizes\.restoreSource,/);
  // a paste / new import never keeps the previous product's size chart
  assert.equal((gen.match(/sizeChart: null,/g) ?? []).length >= 3, true);
  assert.match(gen, /sizes: sizes\.sizes,\s*\n\s*sizesSource: sizes\.source,/);
  const pub = read("components", "steps", "PublishStep.tsx");
  assert.match(pub, /sizesSource: null,\s*\n\s*competitorSizes: \[\],\s*\n\s*competitorSizesSource: null,/);
});

test("sizes are editable on the review card and checked before publishing", () => {
  const card = read("components", "review", "ProductInfoCard.tsx");
  assert.match(card, /<Chip key=\{s\} onRemove=\{\(\) => removeSize\(s\)\}>/);
  assert.match(card, /↺ Competitor sizes/);
  const checks = read("components", "review", "PrePublishChecklist.tsx");
  assert.match(checks, /id: "sizes"/);
  // no sizes can't be published, not even "anyway"; a note is a warning, not an ok
  assert.match(checks, /const noSizes = fails\.some\(\(c\) => c\.id === "sizes"\);/);
  assert.match(checks, /\|\| noSizes;/);
  assert.match(checks, /level: noted \? "warn" : "ok"/);
  assert.match(card, /sizesSource: data\.competitorSizesSource \?\? "competitor"/);
  assert.match(read("components", "steps", "ReviewStep.tsx"), /sizes_source: data\.sizesSource/);
});

test("the size backfill starts sold listings unticked and lives in its own tab", () => {
  const panel = read("components", "after-quotation", "SizeBackfillPanel.tsx");
  assert.match(panel, /r\.status === "change" && r\.orders === 0 && r\.orders_known === true/);
  assert.match(panel, /setLastApply\(done\)/);                  // the apply result survives the re-check
  assert.match(panel, /job\?\.kind === "size_check"/);
  assert.match(panel, /aqSizesApi\.apply\(keys\)/);
  assert.match(panel, /window\.confirm\(/);
  const wb = read("components", "after-quotation", "AfterQuotationWorkbench.tsx");
  assert.match(wb, /<SizeBackfillPanel/);
  // mounted once opened, then hidden: switching tabs mid-write keeps the job
  assert.match(wb, /\{sizesOpened && \(/);
  assert.match(wb, /onRunningChange=\{setSizeJobRunning\}/);
  const api = read("lib", "api.ts");
  const block = api.slice(api.indexOf("export const aqSizesApi"));
  assert.equal((block.match(/call</g) ?? []).length, (block.match(/authed: true/g) ?? []).length);
});
