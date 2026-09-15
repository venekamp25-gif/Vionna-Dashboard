import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AccessoryKind,
  NbCategory,
  STEPS_BY_CATEGORY,
  accessoryKind,
  nbCategory,
} from "../lib/nbCategory";
import { guessProductType } from "../lib/scrape-utils";

// Jewellery, sunglasses, belts, hats, scarves, watches, gloves and hair
// accessories used to fall through to the GARMENT steps: a "back view" that
// hides a necklace, a "full-body shot" of a ring, "fabric texture" of a pair
// of sunglasses — and FR "bague" (a ring) even matched the "bag" substring.
//
// The classification lives on both sides (frontend labels, backend prompts),
// so this CASES list is THE SAME as the one in
// backend/tests/test_nb_category.py: change one, change both.
const CASES: [string, NbCategory, AccessoryKind | null][] = [
  // garments
  ["dress", "garment", null],
  ["blouse", "garment", null],
  ["Vaatteet", "garment", null],
  ["spring dress", "garment", null],          // "ring" only as a whole word
  ["belted midi dress", "garment", null],     // "belt" only as a whole word
  ["cap sleeve dress", "garment", null],      // descriptor stripped
  ["scarf print dress", "garment", null],
  ["kellohame", "garment", null],             // FI bell skirt ≠ kello (watch)
  ["korkea vyötärö housut", "garment", null], // FI high-waist ≠ vyö (belt)
  ["bootcut jeans", "garment", null],
  ["pantalon", "garment", null],              // no "talon" (heel) in it
  ["veste bouclée", "garment", null],         // ≠ boucle d'oreille
  ["oxford shirt", "garment", null],
  ["", "garment", null],
  // shoes
  ["sneakers", "shoes", null],
  ["støvler", "shoes", null],
  ["cap toe boots", "shoes", null],
  // bags
  ["tote bag", "bag", null],
  ["sac à main", "bag", null],
  ["belt bag", "bag", null],                  // compound bag wins over "belt"
  ["skoletaske", "bag", null],                // contains 'sko' and 'taske'
  ["baguette bag", "bag", null],
  // jewellery
  ["bague", "accessory", "jewelry"],          // FR ring — contains "bag"
  ["ring", "accessory", "jewelry"],
  ["earrings", "accessory", "jewelry"],
  ["earring", "accessory", "jewelry"],        // not the whole-word "ring"
  ["øreringe", "accessory", "jewelry"],
  ["boucles d'oreilles", "accessory", "jewelry"],
  ["collier", "accessory", "jewelry"],
  ["kaulakoru", "accessory", "jewelry"],
  ["ketting", "accessory", "jewelry"],
  ["Halskette", "accessory", "jewelry"],
  ["sormus", "accessory", "jewelry"],
  // eyewear
  ["sunglasses", "accessory", "eyewear"],
  ["solbriller", "accessory", "eyewear"],
  ["lunettes de soleil", "accessory", "eyewear"],
  ["aurinkolasit", "accessory", "eyewear"],
  ["zonnebril", "accessory", "eyewear"],
  ["Sonnenbrille", "accessory", "eyewear"],
  // watches
  ["watch", "accessory", "watch"],
  ["montre", "accessory", "watch"],
  ["rannekello", "accessory", "watch"],
  ["armbåndsur", "accessory", "watch"],       // watch before bracelet
  // belts
  ["belt", "accessory", "belt"],
  ["bælte", "accessory", "belt"],
  ["ceinture", "accessory", "belt"],
  ["vyö", "accessory", "belt"],
  ["riem", "accessory", "belt"],
  ["Gürtel", "accessory", "belt"],
  // scarves
  ["scarf", "accessory", "scarf"],
  ["tørklæde", "accessory", "scarf"],
  ["huivi", "accessory", "scarf"],
  // headwear
  ["hat", "accessory", "headwear"],
  ["chapeau", "accessory", "headwear"],
  ["pipo", "accessory", "headwear"],
  ["hoed", "accessory", "headwear"],
  ["Mütze", "accessory", "headwear"],
  // gloves
  ["gloves", "accessory", "gloves"],
  ["handschoenen", "accessory", "gloves"],
  // hair
  ["hair clip", "accessory", "hair"],
  ["hiuspinni", "accessory", "hair"],
  ["chouchou", "accessory", "hair"],
  ["scrunchie", "accessory", "hair"],
  // generic
  ["accessoire", "accessory", "other"],
];

for (const [input, category, kind] of CASES) {
  test(`nbCategory(${JSON.stringify(input)}) → ${category}${kind ? "/" + kind : ""}`, () => {
    assert.equal(nbCategory(input), category);
    if (kind !== null) assert.equal(accessoryKind(input), kind);
  });
}

test("a non-accessory has kind 'other'", () => {
  assert.equal(accessoryKind("dress"), "other");
  assert.equal(accessoryKind("tote bag"), "other");
});

test("every category has four labelled steps, and the accessory set never asks for a back view", () => {
  for (const cat of ["garment", "shoes", "bag", "accessory"] as NbCategory[]) {
    assert.deepEqual(STEPS_BY_CATEGORY[cat].map((s) => s.n), [1, 2, 3, 4]);
  }
  const text = STEPS_BY_CATEGORY.accessory.map((s) => `${s.title} ${s.desc}`).join(" ").toLowerCase();
  for (const bad of ["back view", "fabric", "full-body", "garment"]) {
    assert.ok(!text.includes(bad), `accessory labels mention "${bad}"`);
  }
  assert.ok(text.includes("no model"), "step 3 is the product-only shot");
});

// guessProductType: competitor title (+ handle) → canonical English token.
const product = (title: string, handle = "") =>
  ({ title, handle } as unknown as Parameters<typeof guessProductType>[0]);

const TITLE_CASES: [string, string][] = [
  ["Bague Perle Dorée", "ring"],
  ["Solbriller Milano", "sunglasses"],
  ["Kaulakoru Helmi", "necklace"],
  ["Boucles d'oreilles Créoles", "earrings"],
  ["Armbånd Guld", "bracelet"],
  ["Armbåndsur Classic", "watch"],
  ["Montre Élégante", "watch"],              // "élégante" is not "gants"
  ["Læderbælte", "belt"],
  ["Écharpe en soie", "scarf"],
  ["Chapeau de paille", "hat"],
  ["Handsker i læder", "gloves"],
  ["Hårspænde perle", "hair accessory"],
  ["Smykkesæt", "jewellery"],                // generic jewellery fallback
  ["Cap Sleeve Midi Dress", "dress"],        // was "hat"
  ["Scarf Print Maxi Dress", "dress"],       // was "scarf"
  ["Belted Midi Dress", "dress"],
  ["Ring Handle Tote Bag", "bag"],
  ["Belt Bag Leather", "bag"],
  ["Spring Floral Dress", "dress"],
  ["Robe Longue Été", "dress"],
  ["Kellohame", "skirt"],
  ["Sneakers Blanches", "shoes"],
  ["Sac à main Paris", "bag"],
  ["Something Unrecognised", ""],            // unknown stays "" (never a blind "dress")
];

for (const [title, expected] of TITLE_CASES) {
  test(`guessProductType(${JSON.stringify(title)}) → ${JSON.stringify(expected)}`, () => {
    assert.equal(guessProductType(product(title)), expected);
  });
}

test("guessProductType also reads the handle", () => {
  assert.equal(guessProductType(product("Milano", "milano-solbriller-sort")), "sunglasses");
});
