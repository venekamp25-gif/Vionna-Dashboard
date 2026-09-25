import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SsStoreSummary,
  maxDailyTotal,
  mergedDaily,
  mergedLastHits,
  reasonMatrix,
  ssStoreCodes,
  ssStoreLabel,
} from "../lib/spyShield";

const store = (over: Partial<SsStoreSummary> = {}): SsStoreSummary => ({
  name: "x",
  total: 0,
  by_action: { allow: 0, monitor: 0, block: 0 },
  by_reason: [],
  unique_browsers: 0,
  repeat_hits: 0,
  pt_alarm: 0,
  block_tier_hits: 0,
  daily: [],
  last_hits: [],
  last_hit_at: null,
  ...over,
});

test("store labels know every store incl. .com and fall back to the code", () => {
  assert.equal(ssStoreLabel("com"), "Light Supplier .com");
  assert.equal(ssStoreLabel("dk"), "Vionna DK");
  assert.equal(ssStoreLabel("zz"), "ZZ");
});

test("store codes come out in display order, unknown last", () => {
  assert.deepEqual(ssStoreCodes({ fr: store(), zz: store(), dk: store(), unknown: store() }), [
    "dk",
    "fr",
    "unknown",
    "zz",
  ]);
});

test("reasonMatrix sums per-store counts and sorts by total", () => {
  const rows = reasonMatrix({
    dk: store({
      by_reason: [
        ["ref:app.ppspy.com", 5],
        ["ext:ppspy", 2],
      ],
      last_hits: [
        { ts: "2026-09-25T10:00:00Z", store: "dk", ss_action: "monitor", ss_reason: "ext:ppspy" },
        { ts: "2026-09-25T09:00:00Z", store: "dk", ss_action: "block", ss_reason: "ext:ppspy" },
      ],
    }),
    fr: store({ by_reason: [["ext:ppspy", 4]] }),
  });
  assert.deepEqual(
    rows.map((r) => [r.reason, r.total]),
    [
      ["ext:ppspy", 6],
      ["ref:app.ppspy.com", 5],
    ]
  );
  assert.deepEqual(rows[0].perStore, { dk: 2, fr: 4 });
  assert.deepEqual(rows[0].byAction, { allow: 0, monitor: 1, block: 1 });
});

test("mergedDaily adds stores per day, oldest first; maxDailyTotal never 0", () => {
  const days = mergedDaily({
    dk: store({ daily: [{ day: "2026-09-24", monitor: 2, block: 0, allow: 1 }] }),
    fr: store({
      daily: [
        { day: "2026-09-25", monitor: 1, block: 1, allow: 0 },
        { day: "2026-09-24", monitor: 3, block: 0, allow: 0 },
      ],
    }),
  });
  assert.deepEqual(days, [
    { day: "2026-09-24", monitor: 5, block: 0, allow: 1 },
    { day: "2026-09-25", monitor: 1, block: 1, allow: 0 },
  ]);
  assert.equal(maxDailyTotal(days), 6);
  assert.equal(maxDailyTotal([]), 1);
});

test("mergedLastHits interleaves stores newest first and caps", () => {
  const hits = mergedLastHits(
    {
      dk: store({ last_hits: [{ ts: "2026-09-25T10:00:00Z", store: "dk", ss_action: "monitor" }] }),
      fr: store({
        last_hits: [
          { ts: "2026-09-25T11:00:00Z", store: "fr", ss_action: "block" },
          { ts: "2026-09-25T09:00:00Z", store: "fr", ss_action: "allow" },
        ],
      }),
    },
    2
  );
  assert.deepEqual(
    hits.map((h) => h.ts),
    ["2026-09-25T11:00:00Z", "2026-09-25T10:00:00Z"]
  );
});
