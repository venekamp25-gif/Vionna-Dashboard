import React from "react";
import { StoreKey } from "@/lib/store";

/**
 * Shared store flag SVGs + a keyed map. Import STORE_FLAGS instead of
 * hand-writing `store === "dk" ? <FlagDK/> : <FlagFR/>` ternaries — those
 * silently break when a 3rd store is added. Adding a store = add its flag here.
 */
export function FlagDK() {
  return (
    <svg className="w-7 h-5 rounded-sm shadow-sm" viewBox="0 0 28 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="28" height="20" fill="#C8102E" />
      <rect x="9" width="3" height="20" fill="#fff" />
      <rect y="8.5" width="28" height="3" fill="#fff" />
    </svg>
  );
}

export function FlagFR() {
  return (
    <svg className="w-7 h-5 rounded-sm shadow-sm" viewBox="0 0 28 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="9.33" height="20" fill="#002395" />
      <rect x="9.33" width="9.33" height="20" fill="#fff" />
      <rect x="18.66" width="9.34" height="20" fill="#ED2939" />
    </svg>
  );
}

export function FlagFI() {
  return (
    <svg className="w-7 h-5 rounded-sm shadow-sm" viewBox="0 0 28 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="28" height="20" fill="#fff" />
      <rect x="8" width="4" height="20" fill="#003580" />
      <rect y="8" width="28" height="4" fill="#003580" />
    </svg>
  );
}

export const STORE_FLAGS: Record<StoreKey, React.ReactNode> = {
  dk: <FlagDK />,
  fr: <FlagFR />,
  fi: <FlagFI />,
};
