// Competitor sizes at listing (v1.323). Cases are real values from the survey
// of 9,406 competitor products (30 Sep 2026). backend/tests/test_listing_sizes.py
// runs the SAME table through the server twin — keep them identical.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { competitorSizes, findSizeOption, normCompetitorSize } from "../lib/competitorSizes";
import { normSize, sortSizes } from "../lib/afterQuotation";

type Case = [string, string, string[], string[], string];
// [option name, category, competitor values, expected sizes, expected source]
export const CASES: Case[] = [
  ["Pointure", "shoes", ["35", "36", "37", "38", "39", "40", "41", "42", "43"], ["35", "36", "37", "38", "39", "40", "41", "42", "43"], "competitor"],
  ["Maat", "garment", ["S (36)", "M (38)", "L (40/42)", "XL (44)", "2XL (46)", "3XL (48)"], ["S", "M", "L", "XL", "2XL", "3XL"], "competitor"],
  ["Size", "garment", ["6", "8", "10", "12", "14", "16", "18"], ["XS", "S", "M", "L", "XL", "2XL", "3XL"], "converted-uk"],
  ["Size", "shoes", ["5", "6", "7", "8", "9", "10"], ["38", "39", "40", "41", "42", "43"], "converted-uk"],
  ["SIZE", "garment", ["4", "6", "7", "8", "9", "10", "11"], ["XS", "S", "M", "L", "XL"], "default"],
  ["Koko", "garment", ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"], ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"], "competitor"],
  ["Taille", "garment", ["Taille unique"], ["One Size"], "competitor"],
  ["Taille", "garment", ["S", "M (presque épuisé)", "L Quasi épuisé"], ["S", "M", "L"], "competitor"],
  ["Größe", "shoes", ["UK 2 | EU 35", "35.5", "36", "UK 6 | EU 39", "39.5"], ["35", "35.5", "36", "39", "39.5"], "competitor"],
  ["Taille", "garment", ["M", "S", "XL", "L'", "XXL"], ["S", "M", "L", "XL", "2XL"], "competitor"],
  ["Size", "garment", ["S/M", "L/XL", "XS", "2XL/3XL"], ["XS", "S/M", "L/XL", "2XL/3XL"], "competitor"],
  ["Taille", "garment", ["36.0", "38.0", "40.0"], ["36", "38", "40"], "competitor"],
  ["Size", "accessory", ["XS", "S", "M"], ["One Size"], "one-size"],
  ["Color", "garment", ["Black", "White"], ["XS", "S", "M", "L", "XL"], "default"],
  ["Color", "shoes", ["Black"], ["36", "37", "38", "39", "40", "41"], "shoe-default"],
  ["Forstørrelse", "garment", ["+1.00", "+2.50"], ["XS", "S", "M", "L", "XL"], "default"],
  ["Größe", "garment", ["Einheitsgröße"], ["One Size"], "competitor"],
  ["Taille", "garment", ["XS", "S", "M", "L", "XL"], ["XS", "S", "M", "L", "XL"], "competitor"],
];

test("real competitor size lists become the listing's sizes", () => {
  for (const [name, cat, values, sizes, source] of CASES) {
    const r = competitorSizes([{ name: "Couleur", values: ["Noir", "Blanc"] }, { name, values }], cat);
    assert.deepEqual(r.sizes, sizes, `${name} ${JSON.stringify(values)}`);
    assert.equal(r.source, source, `${name} ${JSON.stringify(values)}`);
  }
});

test("conversions and fallbacks explain themselves; the competitor's values are kept", () => {
  const uk = competitorSizes([{ name: "Size", values: ["6", "8", "10"] }], "garment");
  assert.match(uk.note ?? "", /UK\/AU/);
  assert.deepEqual(uk.raw, ["6", "8", "10"]);
  const none = competitorSizes([{ name: "Couleur", values: ["Noir"] }], "garment");
  assert.match(none.note ?? "", /lists no sizes/);
  assert.equal(competitorSizes([{ name: "Size", values: ["M"] }], "garment").note, "The competitor sells only one size");
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
});

const root = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

test("the import always writes sizes, a new product never inherits the last one's", () => {
  const gen = read("components", "steps", "GenerateStep.tsx");
  assert.match(gen, /const sizes = competitorSizes\(product\?\.options, nbCategory\(productType\)\)/);
  assert.match(gen, /sizes: sizes\.sizes,\s*\n\s*sizesSource: sizes\.source,/);
  const pub = read("components", "steps", "PublishStep.tsx");
  assert.match(pub, /sizesSource: null,\s*\n\s*competitorSizes: \[\],/);
});

test("sizes are editable on the review card and checked before publishing", () => {
  const card = read("components", "review", "ProductInfoCard.tsx");
  assert.match(card, /<Chip key=\{s\} onRemove=\{\(\) => removeSize\(s\)\}>/);
  assert.match(card, /↺ Competitor sizes/);
  const checks = read("components", "review", "PrePublishChecklist.tsx");
  assert.match(checks, /id: "sizes"/);
  assert.match(read("components", "steps", "ReviewStep.tsx"), /sizes_source: data\.sizesSource/);
});

test("the size backfill starts sold listings unticked and lives in its own tab", () => {
  const panel = read("components", "after-quotation", "SizeBackfillPanel.tsx");
  assert.match(panel, /x\.status === "change" && x\.orders === 0/);
  assert.match(panel, /aqSizesApi\.apply\(keys\)/);
  assert.match(panel, /window\.confirm\(/);
  const wb = read("components", "after-quotation", "AfterQuotationWorkbench.tsx");
  assert.match(wb, /<SizeBackfillPanel onDone=/);
  const api = read("lib", "api.ts");
  const block = api.slice(api.indexOf("export const aqSizesApi"));
  assert.equal((block.match(/call</g) ?? []).length, (block.match(/authed: true/g) ?? []).length);
});
