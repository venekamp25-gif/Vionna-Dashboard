"use client";

import { useProduct, colorLabelFor } from "@/lib/product";
import { StoreKey, STORE_CONFIG } from "@/lib/store";
import { Button } from "@/components/ui/Button";

export interface CheckItem {
  id: string;
  label: string;
  level: "ok" | "warn" | "fail";
  detail?: string;
  /**
   * A blocking check cannot be overridden with "Publish anyway" — the popup
   * only offers the way back. Reserved for states that are guaranteed to
   * create broken products, not for heuristics.
   */
  blocking?: boolean;
}

/** True when at least one check makes publishing impossible (see `blocking`). */
export function hasBlockingIssue(checks: CheckItem[]): boolean {
  return checks.some((c) => c.blocking);
}

/**
 * Live pre-publish checks. Used both as a confirmation popup (when the user
 * clicks Publish and there are issues) and as a programmatic "is anything
 * wrong?" inspector for the publish flow.
 */
export function buildPrePublishChecks(
  data: ReturnType<typeof useProduct>["data"],
  stores: StoreKey[],
  takenNamesLower: Set<string>
): CheckItem[] {
  const out: CheckItem[] = [];

  // 1. Product name set + unique
  if (!data.name.trim()) {
    out.push({ id: "name", label: "Product name is empty", level: "fail" });
  } else if (takenNamesLower.has(data.name.toLowerCase())) {
    out.push({
      id: "name",
      label: "Product name is already used in your store",
      level: "fail",
      detail: `"${data.name}" — pick another`,
    });
  } else {
    out.push({ id: "name", label: `Product name "${data.name}" is unique`, level: "ok" });
  }

  // 2. At least one colour
  if (data.canonicalColors.length === 0) {
    out.push({ id: "colors", label: "No colours defined", level: "fail" });
  } else {
    out.push({
      id: "colors",
      label: `${data.canonicalColors.length} ${data.canonicalColors.length === 1 ? "colour" : "colours"} ready`,
      level: "ok",
    });
  }

  // 3. Siblings handle set
  if (!data.siblingsHandle.trim()) {
    out.push({
      id: "siblings",
      label: "Siblings handle missing — colour swatches won't link",
      level: "fail",
    });
  } else {
    out.push({
      id: "siblings",
      label: `Siblings handle: ${data.siblingsHandle}`,
      level: "ok",
    });
  }

  // 4. Publish pool: at least one image per (canonical) colour.
  //
  // A colour with no photos of its own is NOT a warning: the publish flow gives
  // the steps 1-4 photos to the primary colour only (ReviewStep.tsx variantImages
  // / server.py `_publish`), because those photos show the primary colour and
  // would misrepresent any other one. So a colour without step-5 photos is
  // created in Shopify with an empty image list — the post-publish check then
  // reports "No images attached" and "Retry fix" can never repair it (the photo
  // pool is client-side and gone by then). Blocking here is the only moment the
  // product can still be saved. Bug #43/#44/#45, plan #7.
  const selectedPool = data.publishPool.filter((p) => p.selected);
  if (selectedPool.length === 0) {
    out.push({
      id: "pool-empty",
      label: "No photos selected in publish pool",
      level: "fail",
      blocking: true,
      detail:
        "Every product would be created without a single image. Select photos in the publish pool first.",
    });
  } else {
    const primaryCanonical = data.canonicalColors[0] ?? null;
    const hasSharedImages = selectedPool.some((p) => p.color === "shared");
    const missing: string[] = [];
    for (const c of data.canonicalColors) {
      const hasOwn = selectedPool.some((p) => p.color === c);
      const isPrimaryWithShared = c === primaryCanonical && hasSharedImages;
      if (!hasOwn && !isPrimaryWithShared) {
        missing.push(c);
      }
    }
    if (missing.length === 0) {
      out.push({
        id: "pool-coverage",
        label: `Every colour has at least one photo (${selectedPool.length} total)`,
        level: "ok",
      });
    } else {
      out.push({
        id: "pool-coverage",
        label: `${missing.length} ${missing.length === 1 ? "colour has" : "colours have"} no photos`,
        level: "fail",
        blocking: true,
        detail:
          `${missing.join(", ")} — these would be created without any image. ` +
          `Generate step-5 photos for ${missing.length === 1 ? "this colour" : "these colours"}, ` +
          `or remove ${missing.length === 1 ? "it" : "them"} from the colour list.`,
      });
    }
  }

  // 5. Size chart present (scraped from competitor → custom.size_chart metafield)
  const chartRows = data.sizeChart?.rows?.length ?? 0;
  if (chartRows === 0) {
    out.push({
      id: "size-chart",
      label: "No size chart found for this product",
      level: "warn",
      detail:
        "The scrape found no size table — the size guide won't appear on the product page. Add one manually if this product needs sizing.",
    });
  } else {
    out.push({
      id: "size-chart",
      label: `Size chart ready (${chartRows} ${chartRows === 1 ? "row" : "rows"})`,
      level: "ok",
    });
  }

  // 6. Per-store content checks
  for (const store of stores) {
    const content = data.contentByStore[store];
    const isActive = store === data.activeViewStore;
    const description = isActive ? data.description : content?.description ?? "";
    const metaDescription = isActive
      ? data.metaDescription
      : content?.metaDescription ?? "";
    const mTitleSpecs = isActive ? data.mTitleSpecs : content?.mTitleSpecs ?? "";
    const cutline = isActive ? data.cutline : content?.cutline ?? "";
    const storeLabel = STORE_CONFIG[store].label;

    if (!description.trim()) {
      out.push({
        id: `desc-${store}`,
        label: `${storeLabel}: description is empty`,
        level: "fail",
      });
    }

    const metaLen = metaDescription.length;
    if (!metaDescription.trim()) {
      out.push({
        id: `meta-${store}`,
        label: `${storeLabel}: meta description is empty`,
        level: "warn",
      });
    } else if (metaLen > 160) {
      out.push({
        id: `meta-${store}`,
        label: `${storeLabel}: meta description over 160 chars`,
        level: "warn",
        detail: `${metaLen} / 160`,
      });
    }

    if (!mTitleSpecs.trim()) {
      out.push({
        id: `mtitle-${store}`,
        label: `${storeLabel}: m-title-specs is empty`,
        level: "warn",
      });
    }

    if (!cutline.trim()) {
      out.push({
        id: `cutline-${store}`,
        label: `${storeLabel}: cutline is empty`,
        level: "warn",
      });
    }

    const labelsFilled =
      data.canonicalColors.length === 0 ||
      data.canonicalColors.every((c) =>
        (colorLabelFor(data, c, store) || "").trim().length > 0
      );
    if (!labelsFilled) {
      out.push({
        id: `labels-${store}`,
        label: `${storeLabel}: some colour labels are empty`,
        level: "fail",
      });
    }
  }

  return out;
}

interface PopupProps {
  open: boolean;
  checks: CheckItem[];
  onCancel: () => void;
  onPublishAnyway: () => void;
}

/**
 * Confirmation modal shown when the user clicks Publish but the checks
 * surfaced one or more issues. Lists every issue with its severity and lets
 * the user proceed anyway — most checks are heuristics, so an override is
 * right. A check marked `blocking` is not: it is a state that provably
 * creates broken products, and there "Publish anyway" is not offered.
 */
export function PrePublishChecklistPopup({
  open,
  checks,
  onCancel,
  onPublishAnyway,
}: PopupProps) {
  if (!open) return null;

  const fails = checks.filter((c) => c.level === "fail");
  const warns = checks.filter((c) => c.level === "warn");
  const hasFails = fails.length > 0;
  const blocked = hasBlockingIssue(checks);

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg bg-bg-elev border border-border rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-start gap-3">
            <div
              className={[
                "w-10 h-10 rounded-full flex items-center justify-center text-xl font-bold shrink-0",
                hasFails
                  ? "bg-danger/20 text-danger"
                  : "bg-warning/20 text-warning",
              ].join(" ")}
            >
              {hasFails ? "!" : "⚠"}
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-text">
                {blocked
                  ? "Publishing is blocked"
                  : hasFails
                  ? `${fails.length} issue${fails.length === 1 ? "" : "s"} found`
                  : `${warns.length} warning${warns.length === 1 ? "" : "s"}`}
                {!blocked && hasFails && warns.length > 0 && ` · ${warns.length} warning${warns.length === 1 ? "" : "s"}`}
              </h2>
              <p className="text-[12px] text-text-faint mt-1">
                {blocked
                  ? "This would create products without any photo — that can't be repaired afterwards, so publishing can't continue until it's resolved."
                  : hasFails
                  ? "We found problems that may cause your publish to fail or render incorrectly. Review below."
                  : "Things to double-check before publishing. You can proceed anyway if you've already considered them."}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 max-h-[50vh] overflow-y-auto space-y-1.5">
          {fails.map((c) => (
            <CheckLine key={c.id} item={c} />
          ))}
          {warns.map((c) => (
            <CheckLine key={c.id} item={c} />
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-bg-elev-2 rounded-b-2xl">
          <Button variant={blocked ? "primary" : "secondary"} size="sm" onClick={onCancel}>
            ← Back to review
          </Button>
          {!blocked && (
            <Button
              variant={hasFails ? "danger" : "primary"}
              size="sm"
              onClick={onPublishAnyway}
            >
              Publish anyway →
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function CheckLine({ item }: { item: CheckItem }) {
  const icon = item.level === "ok" ? "✓" : item.level === "warn" ? "⚠" : "✗";
  const color =
    item.level === "ok"
      ? "text-accent"
      : item.level === "warn"
      ? "text-warning"
      : "text-danger";
  return (
    <div className="flex items-start gap-2 text-[13px] leading-relaxed">
      <span className={`${color} font-bold w-4 shrink-0 text-center`}>{icon}</span>
      <div className="flex-1">
        <span className="text-text">{item.label}</span>
        {item.detail && (
          <div className="text-[11px] text-text-faint mt-0.5">{item.detail}</div>
        )}
      </div>
    </div>
  );
}
