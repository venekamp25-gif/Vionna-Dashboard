import { test } from "node:test";
import assert from "node:assert/strict";

import { poolWithoutStep } from "../lib/publishChecks";

// ── The step-5 photos of a colour disappeared from the publish pool ─────────
// Reported as "the step 5 images do come in but are not pushed to Shopify".
// The pool used to be cleaned with `label.startsWith("NB Step 5 — " + color)`,
// so a colour whose name starts another colour's name took that one down with
// it. The tiles stayed on screen (they live in nbResultsPerColor), but the
// publish loop reads the pool — so those colours were created empty.

const entry = (color: string, label: string) => ({ color, label, selected: true });

const POOL = [
  entry("Blå", "NB Step 5 — Blå.1"),
  entry("Blå Grå", "NB Step 5 — Blå Grå.1"),
  entry("Blå Grå", "NB Step 5 — Blå Grå.2"),
  entry("Grøn Print", "NB Step 5 — Grøn Print.1"),
  entry("shared", "NB Step 1.1"),
  entry("shared", "NB Step 2.1"),
];

test("clearing a colour leaves a colour whose name starts with it alone", () => {
  const kept = poolWithoutStep(POOL, {
    isStep5: true,
    color: "Blå",
    tagPrefix: "NB Step 5 — Blå",
  });
  // Only the toggled colour comes out; the caller re-adds it.
  assert.deepEqual(
    kept.map((p) => p.label),
    [
      "NB Step 5 — Blå Grå.1",
      "NB Step 5 — Blå Grå.2",
      "NB Step 5 — Grøn Print.1",
      "NB Step 1.1",
      "NB Step 2.1",
    ]
  );
});

test("the label is never matched on, only the colour", () => {
  // Same colour, a label sharing no prefix at all: still cleared.
  const pool = [entry("Guld", "whatever the label happens to say")];
  assert.deepEqual(
    poolWithoutStep(pool, { isStep5: true, color: "Guld", tagPrefix: "NB Step 5 — Guld" }),
    []
  );
});

test("every measured DK prefix pair survives its sibling", () => {
  // Measured on the live DK store (theme.cutline over the whole catalogue):
  // 237 colour names, 58 of which start another one. A sample across the shapes
  // that occur — separate word, glued on, and slashed.
  const pairs: Array<[string, string]> = [
    ["Blå", "Blå Grå"],
    ["Gul", "Guld"],
    ["Guld", "Guld - Hvid"],
    ["Rød", "Rødbrun"],
    ["Pink", "Pink/Rød Blomstret"],
    ["Creme", "Cremefarvet"],
    ["Bordeaux", "Bordeaux rød"],
    ["Lyserød", "Lyserødt guld"],
  ];
  for (const [short, long] of pairs) {
    const pool = [entry(short, `NB Step 5 — ${short}.1`), entry(long, `NB Step 5 — ${long}.1`)];
    const kept = poolWithoutStep(pool, {
      isStep5: true,
      color: short,
      tagPrefix: `NB Step 5 — ${short}`,
    });
    assert.deepEqual(
      kept.map((p) => p.color),
      [long],
      `clearing "${short}" must not touch "${long}"`
    );
  }
});

test("'Sort' does not take its six siblings down with it", () => {
  // The worst case measured on DK: one colour that starts six others.
  const siblings = [
    "Sort & Guld",
    "Sort Læderlook",
    "Sort og hvid",
    "Sort-Lyserød",
    "Sort/Beige",
    "Sort/Hvid",
  ];
  const pool = [entry("Sort", "NB Step 5 — Sort.1")].concat(
    siblings.map((c) => entry(c, `NB Step 5 — ${c}.1`))
  );
  const kept = poolWithoutStep(pool, {
    isStep5: true,
    color: "Sort",
    tagPrefix: "NB Step 5 — Sort",
  });
  assert.deepEqual(kept.map((p) => p.color), siblings);
});

test("clearing a shared step drops only that step's photos", () => {
  const kept = poolWithoutStep(POOL, { isStep5: false, color: "", tagPrefix: "NB Step 1" });
  assert.deepEqual(
    kept.map((p) => p.label),
    [
      "NB Step 5 — Blå.1",
      "NB Step 5 — Blå Grå.1",
      "NB Step 5 — Blå Grå.2",
      "NB Step 5 — Grøn Print.1",
      "NB Step 2.1",
    ]
  );
});

test("a shared step never reaches into the colour photos", () => {
  // Guard the colour side explicitly: a shared step only ever clears shared
  // rows, however broad its label prefix happens to be.
  const kept = poolWithoutStep(POOL, { isStep5: false, color: "", tagPrefix: "NB Step" });
  assert.equal(kept.filter((p) => p.color !== "shared").length, 4);
});
