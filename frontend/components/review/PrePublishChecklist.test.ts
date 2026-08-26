import { describe, expect, it } from "vitest";
import {
  buildPrePublishChecks,
  hasBlockingIssue,
  CheckItem,
} from "@/components/review/PrePublishChecklist";
import type { ProductData, PoolPhoto } from "@/lib/product";
import { StoreKey } from "@/lib/store";

/**
 * Regression cover for bug #43/#44/#45 (plan #7): a colour with no photos of
 * its own was published anyway. The publish flow gives the shared steps 1-4
 * photos to the PRIMARY colour only, so any other colour without step-5 photos
 * reaches Shopify with an empty image list — and nothing after publish can
 * repair that. The checklist has to stop it, not warn about it.
 */

const EMPTY_CONTENT = {
  description: "Een mooie jurk.",
  metaDescription: "Een mooie jurk.",
  mTitleSpecs: "specs",
  cutline: "cutline",
  price: "349,00 DKK",
  colorLabels: { Green: "Grøn", Black: "Sort" },
};

function makeData(pool: Array<Pick<PoolPhoto, "color" | "selected">>): ProductData {
  return {
    name: "Imogen",
    canonicalColors: ["Green", "Black"],
    colors: ["Grøn", "Sort"],
    siblingsHandle: "imogen",
    activeViewStore: "dk" as StoreKey,
    description: EMPTY_CONTENT.description,
    metaDescription: EMPTY_CONTENT.metaDescription,
    mTitleSpecs: EMPTY_CONTENT.mTitleSpecs,
    cutline: EMPTY_CONTENT.cutline,
    contentByStore: { dk: EMPTY_CONTENT, fr: EMPTY_CONTENT, fi: EMPTY_CONTENT },
    sizeChart: { headers: ["Size"], rows: [{ Size: "S" }] },
    publishPool: pool.map((p, i) => ({
      url: `https://example.test/${i}.jpg`,
      label: `photo ${i}`,
      color: p.color,
      selected: p.selected,
    })),
  } as unknown as ProductData;
}

function check(checks: CheckItem[], id: string): CheckItem | undefined {
  return checks.find((c) => c.id === id);
}

const STORES: StoreKey[] = ["dk"];

describe("pre-publish photo coverage", () => {
  it("blocks publishing when a non-primary colour has no photos of its own", () => {
    // Exactly the Imogen case: shared photos + step-5 photos for the primary
    // colour, nothing for the second colour.
    const checks = buildPrePublishChecks(
      makeData([
        { color: "shared", selected: true },
        { color: "Green", selected: true },
      ]),
      STORES,
      new Set<string>()
    );

    const coverage = check(checks, "pool-coverage");
    expect(coverage).toBeDefined();
    expect(coverage?.level).toBe("fail");
    expect(coverage?.blocking).toBe(true);
    expect(coverage?.detail).toContain("Black");
    expect(hasBlockingIssue(checks)).toBe(true);
  });

  it("does not count photos that are deselected in the pool", () => {
    const checks = buildPrePublishChecks(
      makeData([
        { color: "shared", selected: true },
        { color: "Green", selected: true },
        { color: "Black", selected: false },
      ]),
      STORES,
      new Set<string>()
    );

    expect(check(checks, "pool-coverage")?.blocking).toBe(true);
  });

  it("lets a fully covered product through", () => {
    const checks = buildPrePublishChecks(
      makeData([
        { color: "shared", selected: true },
        { color: "Green", selected: true },
        { color: "Black", selected: true },
      ]),
      STORES,
      new Set<string>()
    );

    expect(check(checks, "pool-coverage")?.level).toBe("ok");
    expect(hasBlockingIssue(checks)).toBe(false);
  });

  it("accepts the shared steps 1-4 photos as cover for the PRIMARY colour only", () => {
    // "Green" is primary and has no step-5 photos of its own — the shared
    // photos depict it, so that colour is fine. "Black" is not covered by them.
    const checks = buildPrePublishChecks(
      makeData([{ color: "shared", selected: true }]),
      STORES,
      new Set<string>()
    );

    const coverage = check(checks, "pool-coverage");
    expect(coverage?.level).toBe("fail");
    expect(coverage?.detail).toContain("Black");
    expect(coverage?.detail).not.toContain("Green");
  });

  it("blocks publishing when nothing at all is selected", () => {
    const checks = buildPrePublishChecks(
      makeData([{ color: "shared", selected: false }]),
      STORES,
      new Set<string>()
    );

    expect(check(checks, "pool-empty")?.blocking).toBe(true);
    expect(hasBlockingIssue(checks)).toBe(true);
  });

  it("keeps soft checks overridable — a warning must not block", () => {
    const data = makeData([
      { color: "shared", selected: true },
      { color: "Green", selected: true },
      { color: "Black", selected: true },
    ]);
    const checks = buildPrePublishChecks(
      { ...data, sizeChart: null } as ProductData,
      STORES,
      new Set<string>()
    );

    expect(check(checks, "size-chart")?.level).toBe("warn");
    expect(hasBlockingIssue(checks)).toBe(false);
  });
});
