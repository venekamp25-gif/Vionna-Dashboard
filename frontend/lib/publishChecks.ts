/**
 * Publish-safety rules, kept free of React/Next imports on purpose so they can
 * be unit-tested directly (`npm test` in frontend/ — see tests/publishChecks.test.ts).
 *
 * Both rules here exist because of bug #43 / #44 / #45: a product whose sister
 * colours had no step-5 photos was published anyway (the pre-publish check only
 * warned), and the post-publish screen then offered "Retry fix" for the
 * resulting "No images attached" — a button that cannot attach a photo, so the
 * employee looped on it and filed the same bug once per store.
 */

/** Structural subset of PoolPhoto (lib/product.tsx). */
export interface PoolEntry {
  /** "shared" for the step 1-4 photos, canonical colour name for step 5. */
  color: string;
  selected: boolean;
}

/** Structural subset of ProductVerify["issues"][number] (lib/product.tsx). */
export interface VerifyIssue {
  level: "warn" | "fail";
  msg: string;
}

/** Exactly the message backend/server.py:961 emits when a product has no photo. */
export const MISSING_IMAGES_MSG = "No images attached";

/**
 * The post-publish issues `POST /api/retry_fix` can actually repair. It calls
 * `_publish_to_default_channels` and nothing else (backend/server.py:995-1021),
 * so the sales-channel issue is the entire list. Anything else needs a human or
 * a re-run of an earlier step — offering a retry for it is a dead end.
 */
const RETRY_FIXABLE_MSGS = ["Not on any sales channel"];

export function isRetryFixable(msg: string): boolean {
  return RETRY_FIXABLE_MSGS.includes(msg.trim());
}

export interface RetryAdvice {
  /** At least one issue that "Retry fix" can genuinely repair. */
  canRetry: boolean;
  /** At least one product was created without any photo. */
  missingImages: boolean;
  /** Distinct messages retry cannot do anything about (missing images included). */
  unfixable: string[];
}

/** What, if anything, "Retry fix" can still do for this set of verify issues. */
export function retryFixAdvice(issues: VerifyIssue[]): RetryAdvice {
  const unfixable: string[] = [];
  let canRetry = false;
  for (const issue of issues) {
    if (isRetryFixable(issue.msg)) {
      canRetry = true;
    } else if (!unfixable.includes(issue.msg)) {
      unfixable.push(issue.msg);
    }
  }
  return {
    canRetry,
    missingImages: unfixable.includes(MISSING_IMAGES_MSG),
    unfixable,
  };
}

export interface PoolCoverage {
  /** Canonical colours that would be published without a single photo. */
  missing: string[];
  level: "ok" | "fail";
}

/**
 * Which colours have no photo to publish with.
 *
 * Mirrors what the publish loop actually sends (ReviewStep.tsx:188-194): the
 * PRIMARY colour also gets the shared step 1-4 photos, every other colour gets
 * strictly its own step-5 photos. A colour without those is created empty — and
 * nothing downstream can repair that afterwards, which is why this is a `fail`
 * and not a `warn`.
 */
export function poolCoverage(
  canonicalColors: string[],
  selectedPool: PoolEntry[]
): PoolCoverage {
  const selected = selectedPool.filter((p) => p.selected);
  const hasSharedImages = selected.some((p) => p.color === "shared");
  const primaryCanonical = canonicalColors[0] ?? null;
  const missing: string[] = [];
  for (const c of canonicalColors) {
    const hasOwn = selected.some((p) => p.color === c);
    const isPrimaryWithShared = c === primaryCanonical && hasSharedImages;
    if (!hasOwn && !isPrimaryWithShared) {
      missing.push(c);
    }
  }
  return { missing, level: missing.length === 0 ? "ok" : "fail" };
}
