// The name pool must never hand out a NUMBERED name.
//
// Sept 2026: the pool (365 names) was used up — 772 names in use across DK/FR/FI —
// and the fallback produced "Berit 2", "Ylva 2", "Vigdis 2"… 9 garments, 135
// products, each with a "berit-2-…" handle, "VIONNA-Berit 2-…" SKUs, the number
// in the SEO title and a "berit-2-siblings" collection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WOMEN_NAMES, poolStatus, randomName } from "../lib/names";
import { isNumberedName, nameCheck, slugName } from "../lib/publishChecks";

test("the pool is large, unique by Shopify slug, and every entry is one clean word", () => {
  const slugs = WOMEN_NAMES.map((n) => slugName(n));
  // 1.428 on 2026-09-17 (772 in use). Shrinking the pool is what caused "Berit 2".
  assert.ok(WOMEN_NAMES.length >= 1400, `pool has only ${WOMEN_NAMES.length} names`);
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  assert.deepEqual(dupes, [], "two pool names share a Shopify slug (Adele/Adèle)");
  for (const n of WOMEN_NAMES) {
    assert.match(n, /^\p{Lu}[\p{Ll}]+$/u, `"${n}" is not a single capitalised word`);
    assert.ok(!isNumberedName(n));
  }
});

test("an exhausted pool never yields a number — it composes a name-shaped word", () => {
  for (let i = 0; i < 200; i++) {
    const name = randomName(WOMEN_NAMES);
    assert.ok(name.length >= 4, `got "${name}"`);
    assert.match(name, /^\p{Lu}\p{Ll}+$/u);
    assert.ok(!isNumberedName(name), `numbered fallback is back: "${name}"`);
    assert.ok(!WOMEN_NAMES.some((n) => slugName(n) === slugName(name)));
  }
});

test("a free pool name is preferred, compared by slug (Adèle blocks Adele)", () => {
  const allButOne = WOMEN_NAMES.slice(1).map((n) => n.toUpperCase());
  assert.equal(randomName(allButOne), WOMEN_NAMES[0]);
});

test("poolStatus counts what is left", () => {
  const full = poolStatus([]);
  assert.equal(full.free, full.total);
  const s = poolStatus(WOMEN_NAMES.slice(0, 10));
  assert.equal(s.free, s.total - 10);
  assert.equal(poolStatus(WOMEN_NAMES).free, 0);
});

test("the pre-publish check refuses a numbered name with a way out", () => {
  const c = nameCheck("Berit 2", new Set());
  assert.equal(c.level, "fail");
  assert.match(c.label, /number/);
  assert.match(c.detail ?? "", /↻/);
  assert.equal(nameCheck("Berit", new Set()).level, "ok");
});
