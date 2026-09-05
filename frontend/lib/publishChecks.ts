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
 * The post-publish issues `POST /api/retry_fix` can repair on its own, with
 * nothing but the product ids: it (re)publishes to the default sales channels.
 * Anything else needs a human or a re-run of an earlier step — offering a retry
 * for it is a dead end.
 */
const RETRY_FIXABLE_MSGS = ["Not on any sales channel"];

/**
 * Missing photos are the conditional case. Since plan #9 (bug #46) retry_fix
 * can re-attach them too, but only from URLs we hand it — so this is fixable
 * exactly when the run still holds photos for the affected products. When it
 * doesn't, the honest answer is still "re-do step 5", not a button that loops.
 */
export function isRetryFixable(msg: string, canReattachImages = false): boolean {
  const m = msg.trim();
  if (canReattachImages && m === MISSING_IMAGES_MSG) return true;
  return RETRY_FIXABLE_MSGS.includes(m);
}

export interface RetryAdvice {
  /** At least one issue that "Retry fix" can genuinely repair. */
  canRetry: boolean;
  /** At least one product was created without any photo AND retry cannot fix it. */
  missingImages: boolean;
  /** Distinct messages retry cannot do anything about. */
  unfixable: string[];
}

/**
 * What, if anything, "Retry fix" can still do for this set of verify issues.
 *
 * `canReattachImages` — whether the run still holds photo URLs for the products
 * that came out empty. With them, retry_fix re-attaches the photos itself; only
 * without them is "No images attached" a dead end that needs step 5 re-run.
 */
export function retryFixAdvice(
  issues: VerifyIssue[],
  canReattachImages = false
): RetryAdvice {
  const unfixable: string[] = [];
  let canRetry = false;
  for (const issue of issues) {
    if (isRetryFixable(issue.msg, canReattachImages)) {
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

/** Structural subset of PoolPhoto (lib/product.tsx) incl. its human label. */
export interface LabelledPoolEntry extends PoolEntry {
  /** Display text only, e.g. "NB Step 5 — Blå.2". Never matched on. */
  label: string;
}

/**
 * The pool entries that survive when one step's selection is rebuilt.
 *
 * Toggling a tile re-adds every selected photo for that step, so its previous
 * entries have to come out first. Step 1-4 photos are shared by all colours and
 * are identified by their label; step 5 photos belong to exactly one colour.
 *
 * Bug: step 5 used to be cleaned with `label.startsWith(`NB Step 5 — ${color}`)`.
 * Colour names where one is the start of another are everywhere: of the 237
 * colours measured on DK, 58 are the start of another one ('Blå'/'Blå Grå',
 * 'Gul'/'Guld', 'Rød'/'Rødbrun'), and 'Sort' alone starts six of them
 * ('Sort/Hvid', 'Sort/Beige', 'Sort & Guld', ...). So selecting a photo for
 * 'Sort' silently dropped every entry of those six. The tiles stayed on screen
 * (they live in
 * nbResultsPerColor) but the publish loop reads the POOL, so those colours were
 * created without photos. Compare the `color` field exactly; never the label.
 */
export function poolWithoutStep<T extends LabelledPoolEntry>(
  pool: T[],
  step: { isStep5: boolean; color: string; tagPrefix: string }
): T[] {
  return pool.filter((p) =>
    step.isStep5
      ? p.color !== step.color
      : p.color !== "shared" || !p.label.startsWith(step.tagPrefix)
  );
}

/**
 * Shopify's handle-slug, zodat 'Adele' en 'Adèle' als DEZELFDE naam gelden --
 * Shopify maakt van beide 'adele', en dan botsen ook de siblings-collecties.
 * Afgeleid uit 3.933 bestaande handles: ø->o, æ->ae, å->a, rest via NFKD.
 */
export function slugName(text: string): string {
  const map: Record<string, string> = {
    ø: "o", æ: "ae", å: "a", ä: "a", ö: "o", ü: "u", ß: "ss", œ: "oe", ð: "d", þ: "th", ł: "l",
  };
  return Array.from((text || "").toLowerCase())
    .map((c) => map[c] ?? c)
    .join("")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface NameCheck {
  level: "ok" | "fail";
  label: string;
  detail?: string;
}

/**
 * Is deze productnaam vrij?
 *
 * `takenSlugs`: alle titels in gebruik op de doelwinkels, als slug.
 * `unavailable`: winkels waarvan de lijst NIET geladen kon worden. Die maken
 * de check rood -- een controle die niet is uitgevoerd is geen geslaagde
 * controle. Precies zo kregen 38 kledingstukken een naam die al bezet was: een
 * trage store gaf een lege lijst, en "leeg" werd gelezen als "uniek".
 */
export function nameCheck(
  name: string,
  takenSlugs: Set<string>,
  unavailable: string[] = []
): NameCheck {
  const clean = (name || "").trim();
  if (!clean) return { level: "fail", label: "Product name is empty" };
  if (unavailable.length > 0) {
    return {
      level: "fail",
      label: "Could not verify the product name is unique",
      detail: `Used names could not be loaded for ${unavailable.map((s) => s.toUpperCase()).join(", ")} -- retry before publishing`,
    };
  }
  const slug = slugName(clean);
  if (!slug) return { level: "fail", label: "Product name has no usable letters" };
  if (takenSlugs.has(slug)) {
    return {
      level: "fail",
      label: "Product name is already used in your store",
      detail: `"${clean}" (or a spelling Shopify treats the same) -- pick another`,
    };
  }
  return { level: "ok", label: `Product name "${clean}" is unique` };
}
