import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ── Regenerating left the discarded photos in the publish pool ──────────────
// runStep (steps 1-4) and runColorVariant (step 5) replace the tiles with fresh
// ones that come back UNSELECTED, but used to leave publishPool untouched. The
// old rows stayed on selected:true with the old URLs, so hitting "Regenerate"
// because a colour was wrong published exactly the photos being replaced —
// and poolCoverage still saw a photo for that colour, so nothing warned.
//
// This is a wiring rule, not a pure function: the component cannot be imported
// here (the runner is plain node and cannot read JSX), so the invariant is
// asserted against the source. Compiled output lands in .tsbuild/tests/, so two
// levels up is frontend/.
const SRC = path.join(__dirname, "..", "..", "components", "review", "NanoBananaSteps.tsx");
const src = fs.readFileSync(SRC, "utf8");

/** The setData({...}) object literal a given write lives in. */
function enclosingUpdate(at: number): string {
  const start = src.lastIndexOf("setData(", at);
  assert.notEqual(start, -1, `no setData( wraps offset ${at}`);
  const end = src.indexOf("}));", at);
  return src.slice(start, end === -1 ? undefined : end);
}

function updateContaining(needle: string): string {
  const at = src.indexOf(needle);
  assert.notEqual(at, -1, `reset site not found in the source: ${needle}`);
  return enclosingUpdate(at);
}

test("regenerating a step 1-4 also clears that step's pool entries", () => {
  const block = updateContaining("nbResults: { ...prev.nbResults, [stepNum]: [] }");
  assert.ok(
    block.includes("publishPool"),
    "runStep resets the tiles without clearing publishPool — the replaced photos would still publish"
  );
  assert.ok(
    block.includes("poolWithoutStep"),
    "clear the pool through poolWithoutStep so the rule stays in one place"
  );
});

test("regenerating a colour also clears that colour's pool entries", () => {
  const block = updateContaining(
    "nbResultsPerColor: { ...prev.nbResultsPerColor, [color]: placeholders }"
  );
  assert.ok(
    block.includes("publishPool"),
    "runColorVariant resets the tiles without clearing publishPool — the replaced photos would still publish"
  );
  assert.ok(block.includes("poolWithoutStep"), "clear the pool through poolWithoutStep");
});

test("any future reset site must clear the pool too", () => {
  // Only RESET-shaped writes: the tile array is replaced wholesale by an empty
  // list or by freshly built placeholders. The progressive writes inside the
  // generation loop (`partial`, `finalResults`) are deliberately exempt — they
  // fill in tiles after the reset already emptied the pool, and they never
  // resurrect a previous round's photos.
  const resets = [
    ...src.matchAll(
      /nbResults(?:PerColor)?:\s*\{\s*\.\.\.prev\.nbResults(?:PerColor)?,\s*\[[^\]]+\]:\s*(\[\]|placeholders\b|\w*[Pp]laceholders?\b)/g
    ),
  ];
  assert.ok(
    resets.length >= 2,
    `expected at least the two known reset sites, found ${resets.length}`
  );
  for (const m of resets) {
    const block = enclosingUpdate(m.index ?? 0);
    assert.ok(
      block.includes("poolWithoutStep"),
      `a reset of the tiles near offset ${m.index} does not clear publishPool — ` +
        "the photos being replaced would still be published"
    );
  }
});
