import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SsStoreSummary,
  fmtHitDay,
  fmtHitTime,
  maxDailyTotal,
  mergedDaily,
  mergedLastHits,
  reasonMatrix,
  ssStoreCodes,
  ssStoreLabel,
  storeProgress,
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

test("hit times render in UTC so they line up with the per-day (UTC) rows", () => {
  // 00:40 UTC is 02:40 in Amsterdam — must still read as the 25th, not the 24th/26th.
  assert.match(fmtHitTime("2026-09-25T00:40:00Z"), /^25 Sept?,? 00:40$/);
  assert.match(fmtHitTime("2026-09-25T23:59:00+02:00"), /^25 Sept?,? 21:59$/);
  assert.equal(fmtHitTime(undefined), "");
  assert.equal(fmtHitTime("nonsense"), "nonsense");
  assert.match(fmtHitDay("2026-09-12T23:30:00Z"), /^12 Sept?$/);
  assert.equal(fmtHitDay(null), "");
});

test("storeProgress counts days of data and turns ready at 14", () => {
  const nine = storeProgress("dk", store({ total: 12, first_hit_at: "2026-09-12T08:00:00Z", active_days: 9 }));
  assert.match(nine.text, /^Vionna DK 12 · first hit 12 Sept? · 9 days of data$/);
  assert.equal(nine.ready, false);
  const ready = storeProgress("fr", store({ total: 40, first_hit_at: "2026-09-01T08:00:00Z", active_days: 14 }));
  assert.equal(ready.ready, true);
  // Old backend without the fields: still renders, never ready.
  const bare = storeProgress("fi", store({ total: 1 }));
  assert.equal(bare.text, "Vionna FI 1 · 0 days of data");
  assert.equal(bare.ready, false);
  assert.equal(storeProgress("nl", store({ total: 1, active_days: 1 })).text, "Light Supplier NL 1 · 1 day of data");
});
