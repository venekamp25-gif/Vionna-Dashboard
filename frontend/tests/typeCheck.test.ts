// Import type check (v1.324). Carina, 30 Sep 2026: the competitor page's title
// and description said moccasins; its product type, tags, XS–XL sizes and
// photos said trousers. 24 listings went live as shoes. The backend decides
// (/api/resolve_type); these are the helpers and the wiring around it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CATEGORY_TOKEN,
  describeTypeCheck,
  misleadingFor,
  tokenFor,
  trustedSourceText,
  typeCheckPhotos,
  type TypeCheck,
} from "../lib/typeCheck";

const DEJANA = {
  title: "Dejana | Mocassins confortables et élégants pour femmes",
  body_html: "<p>Ces mocassins allient confort et élégance. Semelle antidérapante.</p>",
  product_type: "Dress Pants Women",
  tags: "pants women, womens",
  images: [{ src: "//cdn/a.jpg" }, { src: "//cdn/b.jpg" }, { src: "//cdn/c.jpg" }],
};

const carina = (over: Partial<TypeCheck> = {}): TypeCheck => ({
  category: "pants",
  decided_by: "photos",
  conflict: true,
  signals: { title: "shoes", product_type: "pants", tags: "pants", description: "shoes", sizes: "alpha" },
  misleading: ["title", "description"],
  vision: { category: "pants", item: "wide-leg trousers", confidence: "high", evidence: "" },
  vision_error: null,
  candidates: [],
  product_type: "trousers",
  ...over,
});

test("the photo check sees several colours: the item that changes colour is the product", () => {
  const photos = typeCheckPhotos(DEJANA, { Noir: ["https://cdn/n1.jpg", "https://cdn/n2.jpg"], Beige: ["https://cdn/b1.jpg"] });
  assert.deepEqual(photos, ["https://cdn/a.jpg", "https://cdn/n1.jpg", "https://cdn/b1.jpg"]);
  // one colour only: still two photos
  assert.deepEqual(typeCheckPhotos(DEJANA, {}), ["https://cdn/a.jpg", "https://cdn/b.jpg"]);
  assert.equal(typeCheckPhotos(DEJANA, { a: ["1"], b: ["2"], c: ["3"], d: ["4"], e: ["5"] }).length, 4);
});

test("fields that described another product never reach keywords or copy", () => {
  const both = trustedSourceText(DEJANA, ["title", "description"]);
  assert.doesNotMatch(both, /mocassin/i);
  assert.match(both, /Dress Pants Women/);
  assert.match(both, /pants women/);
  assert.match(trustedSourceText(DEJANA, ["title"]), /^Ces mocassins/);        // the description was fine
  assert.equal(trustedSourceText(DEJANA, []).startsWith("Dejana"), true);
});

test("after the operator picks, every field that named another type is marked", () => {
  assert.deepEqual(misleadingFor(carina(), "pants"), ["title", "description"]);
  assert.deepEqual(misleadingFor(carina(), "shoes"), ["product_type", "tags"]);
  assert.equal(tokenFor("pants", "", ""), "trousers");
  assert.equal(tokenFor("outerwear", "coat", "outerwear"), "coat");
  assert.equal(tokenFor("pants", "shoes", "shoes"), "trousers");
  assert.equal(CATEGORY_TOKEN.skirt, "skirt");
});

test("Review says in plain words why the type differs from the competitor's title", () => {
  const s = describeTypeCheck(carina()) ?? "";
  assert.match(s, /^Listed as Trousers/);
  assert.match(s, /title and description describe another product/);
  assert.match(s, /product type, tags, sizes, photos/);
  assert.equal(describeTypeCheck(carina({ decided_by: "text", misleading: [], conflict: false })), null);
  assert.match(describeTypeCheck(carina({ decided_by: "operator" })) ?? "", /your choice/);
  assert.match(describeTypeCheck(carina({ category: null, decided_by: "unchecked" })) ?? "", /could not be checked/);
  assert.equal(describeTypeCheck(null), null);
  // the competitor named no type at all and the photos decided: no "disagreed"
  const alone = describeTypeCheck(carina({ conflict: false, misleading: [], signals: {} })) ?? "";
  assert.match(alone, /names no product type/);
  assert.doesNotMatch(alone, /disagree/);
});

test("review fixes: flags survive a store switch, stale runs stop, a hung check times out", () => {
  const prod = read("lib", "product.tsx");
  assert.match(prod, /\.\.\.prev\.contentByStore\[prev\.activeViewStore\],\s*\n\s*description: prev\.description,/);
  const gen = read("components", "steps", "GenerateStep.tsx");
  assert.ok((gen.match(/if \(!alive\.current\) return;/g) ?? []).length >= 4, "every await in the import checks alive");
  assert.match(gen, /setTimeout\(\(\) => ctl\.abort\(\), 45_000\)/);
  assert.match(gen, /typeAnswer\.current\?\.\(null\);\s*\n\s*\};/);           // leaving resolves an open question
  const card = read("components", "review", "GeneratedContentCard.tsx");
  assert.match(card, /data\.productType === data\.typeCheck\.product_type \? \{ garment_category: data\.category \}/);
  assert.match(card, /setData\(\(prev\) =>/);
  assert.match(read("components", "review", "PrePublishChecklist.tsx"), /Product type could not be checked at import/);
});

const root = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

test("the import decides the type BEFORE keywords, copy and sizes — and everything follows it", () => {
  const gen = read("components", "steps", "GenerateStep.tsx");
  const check = gen.indexOf("const typeCheckP = checkType(");
  const research = gen.indexOf("api.researchKeywords(");
  const sizes = gen.indexOf("const sizes = competitorSizes(");
  assert.ok(check > 0 && check < research && check < sizes, "type check runs before research and sizes");
  assert.match(gen, /typeCheck\.decided_by === "operator"/);                     // operator picks, nothing researched before
  assert.match(gen, /competitor_title: typeCheck\.misleading\.includes\("title"\) \? "" :/);
  assert.match(gen, /garment_category: typeCheck\.category,/);
  assert.match(gen, /category: typeCheck\.category,\s*\n\s*typeCheck,/);           // always written: B never inherits A's
  assert.match(gen, /decided_by: "unchecked"/);                                  // a failed check never blocks the import
  assert.match(read("components", "steps", "ReviewStep.tsx"), /category: data\.category,/);
  assert.match(read("components", "steps", "PublishStep.tsx"), /category: null,\s*\n\s*typeCheck: null,/);
  assert.match(read("components", "review", "GeneratedContentCard.tsx"), /type_source_misleading: data\.typeCheck\.misleading/);
  assert.match(read("components", "review", "PrePublishChecklist.tsx"), /id: "type"/);
  assert.match(read("components", "review", "CompetitorPreview.tsx"), /describeTypeCheck\(data\.typeCheck\)/);
  const api = read("lib", "api.ts");
  assert.match(api, /resolveType: \(params[\s\S]*?"\/api\/resolve_type", \{ method: "POST", body: params, authed: true, signal \}/);
});
