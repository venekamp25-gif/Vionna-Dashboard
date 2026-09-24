// The background references for the model shots must be OURS and must exist.
//
// 2026-09-24: all four references were rosamae.com CDN links; the competitor
// removed the files, all four went 404, the backend skipped them silently and
// every product got a different background. product.tsx is a React module, so
// this reads the source instead of importing it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const src = readFileSync(join(root, "lib", "product.tsx"), "utf8");
const block = src.match(/export const BG_REFERENCE_OPTIONS: string\[\] = \[([\s\S]*?)\];/);

test("every background reference is a self-hosted file that exists and is a real image", () => {
  assert.ok(block, "BG_REFERENCE_OPTIONS not found");
  const paths = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(paths.length >= 3, `only ${paths.length} references`);
  for (const p of paths) {
    assert.match(p, /^\/bg-refs\/[a-z0-9-]+\.jpg$/, `${p} is not a local /bg-refs path (external CDNs break)`);
    const file = join(root, "public", p);
    assert.ok(existsSync(file), `${p} missing from frontend/public`);
    assert.ok(statSync(file).size > 20_000, `${p} is suspiciously small`);
    const head = readFileSync(file).subarray(0, 3);
    assert.deepEqual([...head], [0xff, 0xd8, 0xff], `${p} is not a JPEG`);
  }
});

test("the picked reference is made absolute (the backend downloads it by URL)", () => {
  assert.match(src, /export function absoluteBgReferenceUrl\(/);
  assert.match(src, /window\.location\?\.origin/);
  assert.match(src, /PUBLIC_SITE_URL = "https:\/\/fashion-dashboard\.netlify\.app"/);
  assert.match(src, /return absoluteBgReferenceUrl\(BG_REFERENCE_OPTIONS\[/);
});

test("the image step surfaces skipped references instead of hiding them", () => {
  const nb = readFileSync(join(root, "components", "review", "NanoBananaSteps.tsx"), "utf8");
  assert.match(nb, /res\.missing_refs\?\.length/);
  assert.match(nb, /if \(refWarning\) setStepErrors/);
  const api = readFileSync(join(root, "lib", "api.ts"), "utf8");
  assert.match(api, /missing_refs\?: string\[\];/);
});
