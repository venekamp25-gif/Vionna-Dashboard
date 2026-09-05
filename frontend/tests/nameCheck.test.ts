import { test } from "node:test";
import assert from "node:assert/strict";

import { nameCheck, slugName } from "../lib/publishChecks";

// ── 38 garments got a name that was already taken ───────────────────────────
// Two causes, both guarded here. (1) The used-names fetch failed silently for a
// store and the empty list read as "nothing taken", so the check said unique.
// (2) Names were compared lower-cased, but Shopify builds handles from a slug:
// "Adele" and "Adèle" both become "adele" and their siblings collections collide.

test("Shopify-style slug: diacritics fold, Nordic letters become letters", () => {
  assert.equal(slugName("Adèle"), "adele");
  assert.equal(slugName("Adele"), "adele");
  assert.equal(slugName("Thérèse"), "therese");
  // ø has no combining mark, so NFKD alone would turn it into a dash. Measured
  // against 3,933 live handles: Shopify writes "vinrod".
  assert.equal(slugName("Vinrød"), "vinrod");
  assert.equal(slugName("Blå Blomstret"), "bla-blomstret");
  assert.equal(slugName("Søren Æble"), "soren-aeble");
});

test("a name that only differs in accent is NOT unique", () => {
  const taken = new Set([slugName("Adèle")]);
  const r = nameCheck("Adele", taken);
  assert.equal(r.level, "fail");
  assert.match(r.label, /already used/);
});

test("a store whose names could not be loaded makes the check fail", () => {
  // Unknown is not unique. This is exactly how the duplicates slipped through:
  // one slow store, an empty list, and "empty" read as "nothing taken".
  const r = nameCheck("Cordelia", new Set(), ["fr"]);
  assert.equal(r.level, "fail");
  assert.match(r.label, /Could not verify/);
  assert.match(r.detail ?? "", /FR/);
});

test("a genuinely free name passes", () => {
  const r = nameCheck("Cordelia", new Set(["maeve", "adele"]));
  assert.equal(r.level, "ok");
  assert.match(r.label, /unique/);
});

test("an empty or unusable name fails", () => {
  assert.equal(nameCheck("", new Set()).level, "fail");
  assert.equal(nameCheck("   ", new Set()).level, "fail");
  assert.equal(nameCheck("???", new Set()).level, "fail");
});

test("comparison is case-insensitive and whitespace-tolerant", () => {
  const taken = new Set([slugName("Maeve")]);
  assert.equal(nameCheck("  maeve ", taken).level, "fail");
  assert.equal(nameCheck("MAEVE", taken).level, "fail");
});

test("unavailable stores are reported even when the name looks free", () => {
  // Order matters: a missing list must win over an optimistic "unique".
  const r = nameCheck("Cordelia", new Set(), ["dk", "fi"]);
  assert.equal(r.level, "fail");
  assert.match(r.detail ?? "", /DK, FI/);
});
