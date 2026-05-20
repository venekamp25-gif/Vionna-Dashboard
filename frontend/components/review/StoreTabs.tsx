"use client";

import { useProduct } from "@/lib/product";
import { StoreKey, STORE_CONFIG } from "@/lib/store";

function FlagDK() {
  return (
    <svg className="w-5 h-3.5 rounded-sm shadow-sm" viewBox="0 0 28 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="28" height="20" fill="#C8102E" />
      <rect x="9" width="3" height="20" fill="#fff" />
      <rect y="8.5" width="28" height="3" fill="#fff" />
    </svg>
  );
}

function FlagFR() {
  return (
    <svg className="w-5 h-3.5 rounded-sm shadow-sm" viewBox="0 0 28 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="9.33" height="20" fill="#002395" />
      <rect x="9.33" width="9.33" height="20" fill="#fff" />
      <rect x="18.66" width="9.34" height="20" fill="#ED2939" />
    </svg>
  );
}

const FLAGS: Record<StoreKey, React.ReactNode> = {
  dk: <FlagDK />,
  fr: <FlagFR />,
};

interface Props {
  stores: StoreKey[];
  onChange?: (store: StoreKey) => void;
  publishingStore?: StoreKey | null;
}

/**
 * Tab switcher shown above the Review cards when the user picked >1 store.
 * Clicking a tab calls switchView() which flushes current top-level edits into
 * contentByStore[oldActive] and loads contentByStore[newActive] into the mirror.
 */
export function StoreTabs({ stores, onChange, publishingStore }: Props) {
  const { data, switchView } = useProduct();

  return (
    <div className="mb-6 -mt-2">
      <div className="inline-flex bg-bg-elev-2 border border-border rounded-[12px] p-1 gap-1 shadow-sm">
        {stores.map((store) => {
          const active = store === data.activeViewStore;
          const cfg = STORE_CONFIG[store];
          const isPublishing = publishingStore === store;
          return (
            <button
              key={store}
              type="button"
              onClick={() => {
                if (active) return;
                switchView(store);
                onChange?.(store);
              }}
              className={[
                "inline-flex items-center gap-2 px-4 py-2 rounded-[8px] text-[13px] font-medium transition-all duration-150",
                active
                  ? "bg-accent text-on-accent shadow-sm"
                  : "text-text-dim hover:text-text hover:bg-bg-elev",
              ].join(" ")}
            >
              {FLAGS[store]}
              <span>{cfg.label}</span>
              <span
                className={[
                  "text-[10px] font-normal opacity-70",
                  active ? "text-on-accent" : "text-text-faint",
                ].join(" ")}
              >
                {cfg.language}
              </span>
              {isPublishing && (
                <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
              )}
            </button>
          );
        })}
      </div>
      <div className="text-[11px] text-text-faint mt-2 leading-relaxed">
        Edits are saved per store. Switching tabs preserves your changes. Images are shared across all stores.
      </div>
    </div>
  );
}
