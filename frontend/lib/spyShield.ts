/**
 * Pure helpers for the Spy Shield tab (v1.314.0). No React, no "@/" imports:
 * this module is unit-tested on plain node (tsconfig.test.json).
 *
 * The backend (/api/spy_shield/summary) already aggregates per store; what is
 * left here is the cross-store shaping the tab needs — the reason × store ×
 * action matrix and the merged daily bars — plus the store labels, which
 * include ".com" (the COGS map does not know that store).
 */

export type SsAction = "allow" | "monitor" | "block";

export interface SsByAction {
  allow: number;
  monitor: number;
  block: number;
}

export interface SsDaily {
  day: string;
  monitor: number;
  block: number;
  allow: number;
}

export interface SsHit {
  ts: string;
  day?: string;
  store: string;
  ss_action: SsAction | string;
  ss_tier?: string;
  ss_reason?: string;
  ss_ref_host?: string;
  ss_path?: string;
  ss_phase?: string;
  ss_repeat?: number;
  ss_pt?: number;
  ss_mode?: string;
  ss_signals?: string;
  ss_info?: string;
}

export interface SsStoreSummary {
  name: string;
  total: number;
  by_action: SsByAction;
  /** [reason, count] pairs, most frequent first, top 25. */
  by_reason: [string, number][];
  unique_browsers: number;
  repeat_hits: number;
  /** Records with ss_pt=1: the theme did not see itself as the live theme. */
  pt_alarm: number;
  block_tier_hits: number;
  daily: SsDaily[];
  last_hits: SsHit[];
  last_hit_at: string | null;
}

export const SS_STORE_LABELS: Record<string, string> = {
  dk: "Vionna DK",
  fr: "Vionna FR",
  fi: "Vionna FI",
  nl: "Light Supplier NL",
  com: "Light Supplier .com",
  de: "Light Supplier DE",
  unknown: "Unknown store",
};

/** Store codes in the order the tab shows them. */
export const SS_STORE_ORDER = ["dk", "fr", "fi", "nl", "com", "de", "unknown"];

export function ssStoreLabel(code: string): string {
  return SS_STORE_LABELS[code] ?? code.toUpperCase();
}

/** Stores that have records, in display order; unknown codes come last. */
export function ssStoreCodes(stores: Record<string, SsStoreSummary>): string[] {
  const present = Object.keys(stores);
  const known = SS_STORE_ORDER.filter((c) => present.includes(c));
  const rest = present.filter((c) => !SS_STORE_ORDER.includes(c)).sort();
  return [...known, ...rest];
}

export interface ReasonRow {
  reason: string;
  total: number;
  /** store code → count of that reason (all actions). */
  perStore: Record<string, number>;
  /** action → count, derived from the last-hits sample when present, else 0. */
  byAction: SsByAction;
}

/**
 * Reason × store matrix. The per-store reason counts are exact (the backend
 * counts every record); the action split per reason comes from the store's
 * `last_hits` sample, which is all the backend ships per reason — so it is a
 * hint, not a total, and the tab labels it as such.
 */
export function reasonMatrix(stores: Record<string, SsStoreSummary>): ReasonRow[] {
  const rows = new Map<string, ReasonRow>();
  for (const [code, s] of Object.entries(stores)) {
    for (const [reason, count] of s.by_reason ?? []) {
      const row =
        rows.get(reason) ??
        { reason, total: 0, perStore: {}, byAction: { allow: 0, monitor: 0, block: 0 } };
      row.total += count;
      row.perStore[code] = (row.perStore[code] ?? 0) + count;
      rows.set(reason, row);
    }
    for (const h of s.last_hits ?? []) {
      const row = rows.get(h.ss_reason || "none");
      if (!row) continue;
      const a = h.ss_action as SsAction;
      if (a === "allow" || a === "monitor" || a === "block") row.byAction[a] += 1;
    }
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.reason.localeCompare(b.reason));
}

/** Per-day totals merged across the given stores, oldest first. */
export function mergedDaily(stores: Record<string, SsStoreSummary>): SsDaily[] {
  const byDay = new Map<string, SsDaily>();
  for (const s of Object.values(stores)) {
    for (const d of s.daily ?? []) {
      const row = byDay.get(d.day) ?? { day: d.day, monitor: 0, block: 0, allow: 0 };
      row.monitor += d.monitor;
      row.block += d.block;
      row.allow += d.allow;
      byDay.set(d.day, row);
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** All last-hits across stores, newest first, capped. */
export function mergedLastHits(stores: Record<string, SsStoreSummary>, limit = 20): SsHit[] {
  const all: SsHit[] = [];
  for (const s of Object.values(stores)) all.push(...(s.last_hits ?? []));
  return all.sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? "")).slice(0, limit);
}

/** Highest single-day total, for scaling the bar list (never 0). */
export function maxDailyTotal(days: SsDaily[]): number {
  return Math.max(1, ...days.map((d) => d.monitor + d.block + d.allow));
}

/** "2026-09-25T10:31:04Z" → "25 Sep 10:31" (UTC-independent: uses the browser's zone). */
export function fmtHitTime(ts: string | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
