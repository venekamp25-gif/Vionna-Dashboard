import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchLiveBuild, isStaleBuild, tabBuild } from "../lib/buildInfo";

test("a tab is stale only when both shas are real and differ", () => {
  assert.equal(isStaleBuild("abc1234", "def5678"), true);
  assert.equal(isStaleBuild("abc1234", "abc1234"), false);
  assert.equal(isStaleBuild("dev", "def5678"), false); // local dev never nags
  assert.equal(isStaleBuild("abc1234", "dev"), false);
  assert.equal(isStaleBuild("abc1234", null), false); // unreadable build.json
  assert.equal(isStaleBuild("", "def5678"), false);
});

function fakeFetch(handler: () => Partial<Response>): typeof fetch {
  return (async () => handler() as Response) as typeof fetch;
}

test("fetchLiveBuild reads the sha and never throws", async () => {
  const ok = await fetchLiveBuild({
    fetchImpl: fakeFetch(() => ({ ok: true, json: async () => ({ sha: "def5678", builtAt: "2026-09-25T10:00:00Z" }) })),
  });
  assert.equal(ok?.sha, "def5678");
  assert.equal(ok?.builtAt, "2026-09-25T10:00:00Z");
  const missing = await fetchLiveBuild({ fetchImpl: fakeFetch(() => ({ ok: false, status: 404 })) });
  assert.equal(missing, null);
  const broken = await fetchLiveBuild({
    fetchImpl: fakeFetch(() => ({ ok: true, json: async () => ({ nope: 1 }) })),
  });
  assert.equal(broken, null);
  const down = await fetchLiveBuild({
    fetchImpl: (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch,
  });
  assert.equal(down, null);
});

test("the tab's own build is the baked sha, else the first live value it saw", () => {
  assert.equal(tabBuild("abc1234", null), "abc1234");
  assert.equal(tabBuild("abc1234", "zzz9999"), "abc1234");
  assert.equal(tabBuild("dev", "def5678"), "def5678"); // nothing baked (Netlify) → first seen
  assert.equal(tabBuild("dev", null), null);            // nothing known yet → never nags
  assert.equal(tabBuild("dev", "dev"), null);
});
