"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

export interface RecentEntry {
  product_name: string;
  store: string;
  timestamp: string;
  collection_handle?: string | null;
}

/**
 * Pull the most-recent publish history so we can warn about
 * accidentally re-publishing a product with the same name within the last
 * few days. The dashboard's append-only history log is small, so we just
 * fetch a generous slice once and filter in-memory.
 */
export function useRecentHistory(limit = 200) {
  const [entries, setEntries] = useState<RecentEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .history({ limit })
      .then((r) => {
        if (cancelled) return;
        setEntries(r.entries ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [limit]);

  return { entries, loading };
}

/**
 * Find any product_name in the recent history that matches `name`
 * (case-insensitive) and was published within the last `days` days.
 * Returns the most-recent match, or null.
 *
 * Treat one product as "the same publish" if all variants happened within
 * a 60-min window — i.e. they're rows of the SAME multi-colour publish,
 * not separate re-publishes — so we report just one warning, not many.
 */
export function findRecentDuplicate(
  entries: RecentEntry[],
  name: string,
  days = 7
): RecentEntry | null {
  const lower = name.trim().toLowerCase();
  if (!lower) return null;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  // Filter then sort newest first so the first match is the most recent.
  const matches = entries
    .filter((e) => (e.product_name ?? "").trim().toLowerCase() === lower)
    .filter((e) => {
      try {
        return new Date(e.timestamp).getTime() >= cutoffMs;
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return matches[0] ?? null;
}
