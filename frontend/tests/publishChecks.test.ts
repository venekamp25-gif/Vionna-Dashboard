import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MISSING_IMAGES_MSG,
  isRetryFixable,
  poolCoverage,
  retryFixAdvice,
} from "../lib/publishChecks";

// ── Bug #43: colours without their own step-5 photos were published anyway ──
// The pre-publish check only warned, so "Publish anyway" was one click and the
// products landed in the store empty. These colours must fail the check.

test("a sister colour without its own photos fails the check", () => {
  // The exact shape of bug #43: 3 colours, only the shared (step 1-4) photos.
  const pool = [
    { color: "shared", selected: true },
    { color: "shared", selected: true },
  ];
  const { missing, level } = poolCoverage(["Black", "Beige", "Cream"], pool);
  assert.equal(level, "fail");
  assert.deepEqual(missing, ["Beige", "Cream"]);
});

test("the primary colour is covered by the shared photos", () => {
  const { missing, level } = poolCoverage(
    ["Black"],
    [{ color: "shared", selected: true }]
  );
  assert.equal(level, "ok");
  assert.deepEqual(missing, []);
});

test("every colour with its own photo passes", () => {
  const { level } = poolCoverage(["Black", "Beige"], [
    { color: "shared", selected: true },
    { color: "Beige", selected: true },
  ]);
  assert.equal(level, "ok");
});

test("an unselected photo does not count as coverage", () => {
  const { missing, level } = poolCoverage(["Black", "Beige"], [
    { color: "shared", selected: true },
    { color: "Beige", selected: false },
  ]);
  assert.equal(level, "fail");
  assert.deepEqual(missing, ["Beige"]);
});

test("without shared photos even the primary colour fails", () => {
  const { missing } = poolCoverage(["Black", "Beige"], [
    { color: "Beige", selected: true },
  ]);
  assert.deepEqual(missing, ["Black"]);
});

// ── Bug #43 part two: "Retry fix" was offered for problems it cannot solve ──
// retry_fix() only re-publishes to the sales channels (backend/server.py:995),
// so offering it for a missing photo is a loop with no exit.

test("'No images attached' never offers a retry", () => {
  const advice = retryFixAdvice([{ level: "fail", msg: MISSING_IMAGES_MSG }]);
  assert.equal(advice.canRetry, false);
  assert.equal(advice.missingImages, true);
  assert.deepEqual(advice.unfixable, [MISSING_IMAGES_MSG]);
});

test("a sales-channel issue is still retryable", () => {
  const advice = retryFixAdvice([{ level: "warn", msg: "Not on any sales channel" }]);
  assert.equal(advice.canRetry, true);
  assert.equal(advice.missingImages, false);
  assert.deepEqual(advice.unfixable, []);
});

test("a mixed set keeps the retry and still reports the photos", () => {
  const advice = retryFixAdvice([
    { level: "fail", msg: MISSING_IMAGES_MSG },
    { level: "warn", msg: "Not on any sales channel" },
  ]);
  assert.equal(advice.canRetry, true);
  assert.equal(advice.missingImages, true);
});

test("other post-publish issues retry cannot touch are listed once", () => {
  const advice = retryFixAdvice([
    { level: "fail", msg: "No variants" },
    { level: "warn", msg: "No cutline (colour swatch)" },
    { level: "fail", msg: "No variants" },
  ]);
  assert.equal(advice.canRetry, false);
  assert.equal(advice.missingImages, false);
  assert.deepEqual(advice.unfixable, ["No variants", "No cutline (colour swatch)"]);
});

test("no issues at all means nothing to retry", () => {
  const advice = retryFixAdvice([]);
  assert.equal(advice.canRetry, false);
  assert.equal(advice.missingImages, false);
  assert.deepEqual(advice.unfixable, []);
});

test("only the exact backend messages count as retryable", () => {
  assert.equal(isRetryFixable("Not on any sales channel"), true);
  assert.equal(isRetryFixable("No images attached"), false);
  assert.equal(isRetryFixable("Siblings link missing"), false);
});
