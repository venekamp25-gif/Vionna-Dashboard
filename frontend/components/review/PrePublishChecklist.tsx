"use client";

import { useState } from "react";
import { useProduct, colorLabelFor } from "@/lib/product";
import { StoreKey, STORE_CONFIG } from "@/lib/store";

interface CheckItem {
  id: string;
  label: string;
  level: "ok" | "warn" | "fail";
  detail?: string;
}

interface Props {
  /** Names already used across all selected stores (lowercased). */
  takenNamesLower: Set<string>;
}

/**
 * Live pre-flight checks shown right above the Publish button. Catches the
 * most common mistakes before they hit Shopify — missing colour photos, name
 * conflicts, meta description over 160 chars, no siblings handle, etc.
 *
 * Each check returns one of:
 *   - "ok"   — green, no issue
 *   - "warn" — yellow, will publish but probably not what you want
 *   - "fail" — red, will likely break something (Shopify rejection / theme bug)
 */
export function PrePublishChecklist({ takenNamesLower }: Props) {
  const { data } = useProduct();
  const [expanded, setExpanded] = useState(false);

  const targetStores = data.selectedStores.length
    ? data.selectedStores
    : (["dk"] as StoreKey[]);

  const checks = buildChecks(data, targetStores, takenNamesLower);
  const failCount = checks.filter((c) => c.level === "fail").length;
  const warnCount = checks.filter((c) => c.level === "warn").length;
  const allOk = failCount === 0 && warnCount === 0;

  const summary = allOk
    ? "✓ Ready to publish"
    : failCount > 0
    ? `⚠ ${failCount} ${failCount === 1 ? "issue" : "issues"} to fix${warnCount > 0 ? ` · ${warnCount} warning${warnCount === 1 ? "" : "s"}` : ""}`
    : `⚠ ${warnCount} warning${warnCount === 1 ? "" : "s"}`;

  const headerColor = allOk
    ? "text-accent border-accent/40 bg-accent/8"
    : failCount > 0
    ? "text-danger border-danger/40 bg-danger/8"
    : "text-warning border-warning/40 bg-warning/10";

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-[10px] border text-[12px] font-medium transition-colors ${headerColor}`}
      >
        <span className="flex items-center gap-2">
          <span>Pre-publish checklist</span>
          <span className="text-text-faint font-normal">— {summary}</span>
        </span>
        <span className="text-[10px] text-text-faint">{expanded ? "▲ Hide" : "▼ Show"}</span>
      </button>

      {expanded && (
        <div className="mt-2 px-3 py-2.5 rounded-[10px] bg-bg-elev-2 border border-border space-y-1.5">
          {checks.map((c) => (
            <CheckLine key={c.id} item={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function CheckLine({ item }: { item: CheckItem }) {
  const icon =
    item.level === "ok" ? "✓" : item.level === "warn" ? "⚠" : "✗";
  const color =
    item.level === "ok"
      ? "text-accent"
      : item.level === "warn"
      ? "text-warning"
      : "text-danger";
  return (
    <div className="flex items-start gap-2 text-[12px] leading-relaxed">
      <span className={`${color} font-bold w-4 shrink-0 text-center`}>{icon}</span>
      <div className="flex-1">
        <span className="text-text">{item.label}</span>
        {item.detail && (
          <span className="ml-2 text-[11px] text-text-faint">{item.detail}</span>
        )}
      </div>
    </div>
  );
}

function buildChecks(
  data: ReturnType<typeof useProduct>["data"],
  stores: StoreKey[],
  takenNamesLower: Set<string>
): CheckItem[] {
  const out: CheckItem[] = [];

  // 1. Product name set
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

  // 4. Publish pool: at least one image per (canonical) colour
  const selectedPool = data.publishPool.filter((p) => p.selected);
  if (selectedPool.length === 0) {
    out.push({
      id: "pool-empty",
      label: "No photos selected in publish pool",
      level: "fail",
      detail: "Products will be created without images",
    });
  } else {
    // Per-colour image coverage. "shared" images count toward the primary colour.
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
        level: "warn",
        detail: missing.join(", "),
      });
    }
  }

  // 5. Per-store content checks
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
    } else {
      out.push({
        id: `meta-${store}`,
        label: `${storeLabel}: meta description ${metaLen} chars`,
        level: "ok",
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

    // Colour labels populated for every canonical colour?
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
