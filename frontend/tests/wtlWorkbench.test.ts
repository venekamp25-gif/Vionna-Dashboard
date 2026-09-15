// Source-level wiring guard for the What-to-list workbench (a JSX component
// cannot be imported by these node tests). Locks in the three behaviours behind
// venek's 2026-09-15 request ("2,5 hours, always the same stores, not fashion"):
//   1. step ① results render PER MARKET as each call returns;
//   2. discovery shows found stores WHILE the job runs (live list);
//   3. proven non-fashion stores are filtered (unknown stays visible).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const wb = readFileSync(join(root, "components", "research", "WhatToListWorkbench.tsx"), "utf8");
const api = readFileSync(join(root, "lib", "api.ts"), "utf8");

test("step ① lands per market instead of after the slowest one", () => {
  assert.match(wb, /setResults\(\(prev\) => \(\{ \.\.\.\(prev \?\? \{\}\), \[s\]: v \}\)\)/);
  assert.match(wb, /results && resultStores\.length > 0 &&/);
  // the old all-or-nothing gate must be gone (count, not doesNotMatch — a failure
  // must not dump the whole component into the test log)
  assert.equal((wb.match(/\{results && !busy && \(/g) ?? []).length, 0);
  assert.match(wb, /cleanOk === false/); // fail-open cleaner is surfaced, not hidden
});

test("discovery polls the job's live list and reloads stores as they get added", () => {
  assert.match(wb, /if \(j\.live\) setDiscoverLive\(j\.live\)/);
  assert.match(wb, /r\.status\.startsWith\("added"\)/);
  assert.match(wb, /discoverLive\.found\.map/);
  assert.match(api, /live\?: DiscoverLive/);
  assert.match(api, /"checking" \| "added" \| "added_unverified" \| "rejected" \| "gated" \| "error"/);
});

test("non-fashion stores are hidden only when PROVEN, never when unchecked", () => {
  assert.match(wb, /\[hideNonFashion, setHideNonFashion\] = useState\(true\)/); // default on
  assert.match(wb, /\(!hideNonFashion \|\| s\.niche\?\.status !== "no"\)/);
  assert.match(wb, /niche not checked/);
  assert.match(api, /wtlStoresNiche: \(max = 150\)/);
  assert.match(api, /niche: WtlNiche \| null;/);
});

test("scan header names the non-fashion items the scan left out", () => {
  assert.match(wb, /scan\.dropped && Object\.keys\(scan\.dropped\)\.length > 0/);
  assert.match(api, /dropped\?: Record<string, number>;/);
});
