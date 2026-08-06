#!/usr/bin/env bash
# Run exactly what .github/workflows/ci.yml runs, on this machine.
#
# Why this exists: on 2026-08-06 GitHub Actions stopped assigning runners to
# this repo (runner_id 0, jobs cancelled after ~15 min queued, five runs in a
# row) while the code was fine. Three PRs had to be merged on a verdict that
# existed only in a chat transcript. This script makes that verdict
# reproducible: anyone can run it and get the same pass/fail CI would give.
#
# It is NOT a replacement for CI — it cannot vouch for a clean checkout, and it
# runs on whatever versions happen to be installed here. It is the fallback for
# when the real gate is unavailable, and a fast pre-push check the rest of the
# time.
#
# Usage:  bash scripts/ci-local.sh          (from the repo root)
# Exit 0 = everything CI checks passed.

set -uo pipefail
cd "$(dirname "$0")/.."

FAILED=()
run() {
  local name="$1"; shift
  printf '\n\033[1m── %s\033[0m\n' "$name"
  if "$@"; then
    printf '\033[32m   PASS\033[0m — %s\n' "$name"
  else
    printf '\033[31m   FAIL\033[0m — %s\n' "$name"
    FAILED+=("$name")
  fi
}

# ── Job: Backend tests + import smoke ──
run "Compile-check the live backend" \
  python3 -m py_compile backend/server.py backend/shipping_check.py

run "pytest (incl. server.py import smoke test)" \
  python3 -m pytest backend/tests -q

# ── Job: Frontend type-check + build ──
# npm ci is skipped when node_modules is already present: it is the slowest step
# by far and a stale tree is obvious from the two checks that follow.
if [ ! -d frontend/node_modules ]; then
  run "npm ci" npm --prefix frontend ci
fi

run "Type-check (tsc --noEmit)" \
  npx --prefix frontend tsc --noEmit -p frontend/tsconfig.json

run "Build (same as Netlify publish)" \
  npm --prefix frontend run build

# ── Verdict ──
printf '\n'
if [ ${#FAILED[@]} -eq 0 ]; then
  printf '\033[32m✔ All CI checks passed.\033[0m\n'
  exit 0
fi
printf '\033[31m✘ %d CI check(s) failed:\033[0m\n' "${#FAILED[@]}"
printf '   - %s\n' "${FAILED[@]}"
exit 1
