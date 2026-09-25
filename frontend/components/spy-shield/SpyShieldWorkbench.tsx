"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, SpyShieldSummary } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import {
  SS_MONITOR_DAYS,
  SS_STORE_ORDER,
  fmtHitTime,
  maxDailyTotal,
  mergedDaily,
  mergedLastHits,
  reasonMatrix,
  ssStoreCodes,
  ssStoreLabel,
  storeProgress,
} from "@/lib/spyShield";

type Days = 7 | 14 | 30;
type Tone = "normal" | "danger" | "warning" | "muted" | "ok";

/** Een KPI-tegel. `tone` kleurt de hele tegel: rood = stopcriterium geraakt,
 *  oranje = onbeslist (orders niet leesbaar — géén groen pad), grijs = niet
 *  van toepassing (Light Supplier heeft geen orders hier). */
function Tile({
  label,
  value,
  hint,
  tone = "normal",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: Tone;
}) {
  const cls =
    tone === "danger"
      ? "border-danger/50 bg-danger/10 text-danger"
      : tone === "warning"
        ? "border-warning/50 bg-warning/10 text-text"
        : tone === "ok"
          ? "border-accent/40 bg-accent/10 text-text"
          : tone === "muted"
            ? "border-border bg-bg-elev text-text-faint"
            : "border-border bg-bg-elev text-text";
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <div className="text-[11px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-[22px] font-semibold leading-tight mt-1">{value}</div>
      {hint && <div className="text-[11px] mt-1 opacity-80">{hint}</div>}
    </div>
  );
}

function Banner({ tone, children }: { tone: "danger" | "warning"; children: React.ReactNode }) {
  const cls =
    tone === "danger"
      ? "border-danger/40 bg-danger/10 text-danger"
      : "border-warning/40 bg-warning/10 text-text";
  return <div className={`rounded-md border px-3 py-2.5 mb-3 text-[12.5px] ${cls}`}>{children}</div>;
}

export function SpyShieldWorkbench() {
  const [days, setDays] = useState<Days>(14);
  const [store, setStore] = useState<string>("all");
  const [data, setData] = useState<SpyShieldSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupMsg, setSetupMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (d: Days, s: string) => {
    setLoading(true);
    setErr(null);
    try {
      setData(await api.spyShieldSummary(d, s));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days, store);
  }, [days, store, load]);

  const stores = useMemo(() => data?.stores ?? {}, [data]);
  const codes = useMemo(() => ssStoreCodes(stores), [stores]);
  const matrix = useMemo(() => reasonMatrix(stores), [stores]);
  const daily = useMemo(() => mergedDaily(stores), [stores]);
  const dailyMax = useMemo(() => maxDailyTotal(daily), [daily]);
  const lastHits = useMemo(() => mergedLastHits(stores, 20), [stores]);
  const totals = data?.totals;
  const buyers = data?.buyers_flagged;
  const dropped = data?.dropped ?? {};

  // Light Supplier alleen geselecteerd → de koper-check kan daar niets zeggen.
  const buyersNa = store !== "all" && !(buyers?.supported_stores ?? ["dk", "fr", "fi"]).includes(store);
  const buyersUnknown = !buyersNa && (buyers?.count === null || buyers?.count === undefined);
  const buyersValue = buyersNa ? "n/a" : buyersUnknown ? "?" : buyers?.count ?? 0;
  const buyersTone: Tone = buyersNa
    ? "muted"
    : buyersUnknown
      ? "warning"
      : (buyers?.count ?? 0) > 0
        ? "danger"
        : "normal";
  const ptActive = !!totals?.pt_alarm_active;
  const ptPct = totals && totals.total > 0 ? Math.round((100 * totals.pt_alarm) / totals.total) : 0;

  const runSetup = async (rotate: boolean) => {
    if (rotate) {
      const ok = window.confirm(
        "Generate a NEW beacon URL? The old URL stops being accepted immediately. " +
          "Stores that are in Block mode KEEP blocking but stop logging (blind) until you paste " +
          "the new URL — the theme only refuses Block when the URL field is EMPTY, not when it is wrong. " +
          "Set those stores to Monitor first, then rotate, then paste. Continue?"
      );
      if (!ok) return;
    }
    setSetupBusy(true);
    setSetupMsg(null);
    try {
      const r = await api.spyShieldSetup(rotate);
      if (r.error) throw new Error(r.error);
      setSetupMsg(
        rotate
          ? "New beacon URL generated — paste it in all six themes now; a store in Block is blind until you do."
          : "Beacon URL generated."
      );
      await load(days, store);
    } catch (e) {
      setSetupMsg(e instanceof Error ? e.message : "setup failed");
    } finally {
      setSetupBusy(false);
    }
  };

  const copyUrl = async () => {
    if (!data?.beacon_url) return;
    try {
      await navigator.clipboard.writeText(data.beacon_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const empty = !loading && data && totals && totals.total === 0;
  const droppedToken = dropped.token ?? 0;
  const droppedOff = dropped.off ?? 0;
  const droppedFlood = (dropped.rate_day ?? 0) + (dropped.full ?? 0);

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="sticky top-0 z-10 bg-bg/95 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-5 py-3 flex items-center gap-4">
          <Link href="/" className="text-[13px] text-accent hover:underline whitespace-nowrap">
            ← Dashboard
          </Link>
          <div className="flex-1">
            <h1 className="text-[15px] font-semibold">Spy Shield</h1>
            <p className="text-[11.5px] text-text-dim">
              Competitor-research traffic the theme snippet detected on the stores — the monitor log
              behind the fake 502 page. All times are UTC.
            </p>
          </div>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value) as Days)}
            className="text-[12px] bg-surface border border-border rounded px-2 py-1"
          >
            <option value={7}>Today + last 6 days</option>
            <option value={14}>Today + last 13 days</option>
            <option value={30}>Today + last 29 days</option>
          </select>
          <select
            value={store}
            onChange={(e) => setStore(e.target.value)}
            className="text-[12px] bg-surface border border-border rounded px-2 py-1"
          >
            <option value="all">All stores</option>
            {SS_STORE_ORDER.filter((c) => c !== "unknown").map((c) => (
              <option key={c} value={c}>
                {ssStoreLabel(c)}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => void load(days, store)} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-5 py-5">
        {err && (
          <p className="text-[12.5px] rounded-md border border-danger/40 bg-danger/10 text-danger px-3 py-2 mb-4">
            {err}
          </p>
        )}

        {/* Beacon URL panel — the one thing the theme needs before Block mode. */}
        {data && (
          <div className="rounded-lg border border-border bg-bg-elev p-4 mb-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <h2 className="text-[13px] font-semibold">Beacon URL</h2>
                {data.configured && data.beacon_url ? (
                  <>
                    <code className="block mt-2 text-[12px] break-all rounded bg-surface border border-border px-2 py-1.5 select-all">
                      {data.beacon_url}
                    </code>
                    <p className="text-[11.5px] text-text-dim mt-2">
                      Paste this in Theme settings › Spy Shield › Beacon-URL (each of the 6 stores, one and
                      the same URL). Block mode in the theme refuses to switch on while this field is empty.
                      The URL is visible in every storefront page&rsquo;s source, so it is not a secret — it
                      only keeps random scanners out.
                    </p>
                  </>
                ) : (
                  <p className="text-[12px] text-text-dim mt-1">
                    <strong className="text-text">No beacon URL yet.</strong> Generate one, then paste it in
                    Theme settings › Spy Shield › Beacon-URL. Until then every store stays in Monitor at
                    most and nothing is logged here.
                  </p>
                )}
                {setupMsg && <p className="text-[11.5px] mt-2 text-text-dim">{setupMsg}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                {data.configured && data.beacon_url ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => void copyUrl()}>
                      {copied ? "Copied" : "Copy"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void runSetup(true)} disabled={setupBusy}>
                      Rotate…
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={() => void runSetup(false)} disabled={setupBusy}>
                    {setupBusy ? "Generating…" : "Generate beacon URL"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Warnings the backend can actually distinguish — before any number. */}
        {data && droppedToken > 0 && (
          <Banner tone="warning">
            <strong>{droppedToken} beacons arrived with an old/wrong token</strong> since the server started —
            a theme still has an outdated URL pasted (typical after a rotation). Re-paste the URL above in
            every store; a store left in Block with the old URL blocks <em>blind</em>.
          </Banner>
        )}
        {data && droppedOff > 0 && (
          <Banner tone="warning">
            The beacon kill switch is on (<code>SPY_SHIELD_BEACON=0</code> in the droplet&rsquo;s .env):{" "}
            {droppedOff} beacons were dropped. Nothing is being logged.
          </Banner>
        )}
        {data && (droppedFlood > 0 || data.log_full) && (
          <Banner tone="warning">
            <strong>Records were dropped</strong> ({dropped.rate_day ?? 0} over the daily budget
            {data.log_full || (dropped.full ?? 0) > 0 ? `, ${dropped.full ?? 0} because the log file is at its size cap` : ""}
            ) — the log may be incomplete for today; a &ldquo;0&rdquo; in this period is not proof.
          </Banner>
        )}

        {/* KPI tiles */}
        {data && totals && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            <Tile
              label="Would-be blocks"
              value={totals.block_tier_hits}
              hint="visitors that would get the 502 in Block mode (in Monitor they saw the normal page)"
            />
            <Tile
              label="502s actually shown"
              value={totals.by_action.block}
              hint="only counts once a store is in Block mode"
            />
            <Tile
              label="Monitor-tier signals"
              value={totals.by_action.allow}
              hint="signals that never block (measure-only)"
            />
            <Tile
              label="Browser-days"
              value={totals.unique_browsers}
              hint={`same browser counts again each day (hash rotates daily) · ${totals.repeat_hits} returned with a block cookie — only possible in Block mode`}
            />
            <Tile
              label="Buyers in flagged sessions"
              value={buyersValue}
              tone={buyersTone}
              hint={
                buyersNa
                  ? "Buyer check covers Vionna DK/FR/FI only (Light Supplier not wired up yet)"
                  : buyersUnknown
                    ? "orders not readable — undecided, NOT proof of 0"
                    : (buyers?.count ?? 0) > 0
                      ? `STOP: do not switch to Block — investigate first (${buyers?.matched_browsers ?? "?"} browser${(buyers?.matched_browsers ?? 0) === 1 ? "" : "s"} behind it)`
                      : "orders that landed on a page + time where a block-tier signal fired (same store, ±60 min). In Monitor that buyer saw the normal page — but would get the 502 in Block."
              }
            />
            <Tile
              label="Preview-theme records (ss_pt)"
              value={totals.pt_alarm}
              tone={ptActive ? "danger" : "normal"}
              hint={
                ptActive
                  ? `${ptPct}% of records come from an unpublished theme in the last 2 days — if you are NOT testing a duplicate right now, the live theme no longer reports itself as 'main' and the shield is effectively off: check theme.role`
                  : totals.pt_alarm > 0
                    ? "records sent from an unpublished/preview theme — expected while you test the duplicate; only a problem if a LIVE store keeps sending these after you stopped testing"
                    : "0 = the live theme sees itself as main"
              }
            />
          </div>
        )}

        {buyers?.note && data && <p className="text-[11.5px] text-text-dim mb-4">{buyers.note}</p>}

        {buyers && buyers.orders.length > 0 && (
          <div className="rounded-lg border border-danger/40 mb-5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead className="bg-danger/10 text-danger">
                  <tr>
                    <th className="text-left px-3 py-2">Order</th>
                    <th className="text-left px-3 py-2">Store</th>
                    <th className="text-left px-3 py-2">Ordered (UTC)</th>
                    <th className="text-left px-3 py-2">Landing path</th>
                    <th className="text-left px-3 py-2">Signal</th>
                    <th className="text-left px-3 py-2">Signal at (UTC)</th>
                    <th className="text-left px-3 py-2">Store was in</th>
                  </tr>
                </thead>
                <tbody>
                  {buyers.orders.map((o) => (
                    <tr key={`${o.store}-${o.order_name}`} className="border-t border-border">
                      <td className="px-3 py-1.5 font-medium">{o.order_name}</td>
                      <td className="px-3 py-1.5">{ssStoreLabel(o.store)}</td>
                      <td className="px-3 py-1.5">{fmtHitTime(o.created_at)}</td>
                      <td className="px-3 py-1.5 font-mono text-[11.5px]">{o.landing_site}</td>
                      <td className="px-3 py-1.5">{o.matched_reason}</td>
                      <td className="px-3 py-1.5">{fmtHitTime(o.matched_at)}</td>
                      <td className="px-3 py-1.5">
                        {o.matched_mode === "block"
                          ? "Block — the 502 did not stop this buyer: roll that store back to Monitor"
                          : "Monitor — buyer saw the normal page"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2.5 text-[12px] border-t border-danger/30 bg-danger/5">
              <strong>How to investigate:</strong> open the order in Shopify Admin. Real customer (address,
              name, history)? Then the signal was a false positive — do NOT switch; find the reason in the
              &ldquo;Signal&rdquo; column and add the host to <em>Extra nooit-blokkeren domeinen</em> or the
              extension id to <em>Ingebouwde extensie-id&rsquo;s uitschakelen</em>, then wait {SS_MONITOR_DAYS}{" "}
              clean days again. Test order / your own visit? Note it and ignore. The match is by landing page
              and time, not by cookie, so a coincidence is possible — check the order, do not guess.
              {" "}
              {buyers.matched_browsers !== undefined && (
                <>
                  All {buyers.orders.length} matched signal{buyers.orders.length === 1 ? "" : "s"} came from{" "}
                  {buyers.matched_browsers} browser{buyers.matched_browsers === 1 ? "" : "s"}
                  {buyers.matched_browsers === 1 && buyers.orders.length > 1
                    ? " — one source; the beacon URL is public, so this can be forged: read the raw log before you act"
                    : ""}
                  .
                </>
              )}
            </div>
          </div>
        )}

        {/* Empty state — an empty pipeline must never read as "clean", but it is not "broken" either. */}
        {loading && !data ? (
          <p className="text-[12.5px] text-text-faint">Loading…</p>
        ) : empty ? (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-3 mb-5 text-[12.5px]">
            <strong>No records in this period</strong>
            {store !== "all" ? ` for ${ssStoreLabel(store)}` : ""}. That is not proof of &ldquo;no
            spies&rdquo; — a quiet store sends nothing (only visits with a signal are reported). Test the
            pipe yourself: open the store once with <code>?ss_bypass=&lt;key&gt;</code>, then with{" "}
            <code>?ss_debug=1</code>, and press Refresh here — one <code>allow op_cookie</code> row must
            appear. If it does not: (1) Theme settings › Spy Shield › Stand must be <em>Monitor</em>, not{" "}
            <em>Uit</em>; (2) the Beacon-URL field must contain exactly the URL above. A live store must show
            at least 1 hit before it can ever be switched to Block.
          </div>
        ) : null}

        {data && totals && totals.total > 0 && (
          <>
            <p className="text-[11.5px] text-text-dim mb-1">
              {totals.total} records · last hit {fmtHitTime(totals.last_hit_at ?? undefined) || "—"} UTC
              {totals.utm_hits ? ` · ${totals.utm_hits} with baked-in UTMs (ss_utm)` : ""}
            </p>
            <ul className="text-[11.5px] mb-4 flex flex-wrap gap-x-4 gap-y-1">
              {codes.map((c) => {
                const p = storeProgress(c, stores[c]);
                return (
                  <li key={c} className={p.ready ? "text-accent" : "text-text-dim"} title={p.ready ? `≥ ${SS_MONITOR_DAYS} days of data` : `needs ${SS_MONITOR_DAYS} days of data in Monitor before Block`}>
                    {p.ready ? "✓ " : ""}
                    {p.text}
                  </li>
                );
              })}
            </ul>

            {/* Reason × store × action */}
            <h2 className="text-[13px] font-semibold mb-2">Reasons per store</h2>
            <div className="overflow-x-auto rounded-lg border border-border mb-5">
              <table className="w-full text-[12.5px]">
                <thead className="bg-surface text-text-dim">
                  <tr>
                    <th className="text-left px-3 py-2">Reason</th>
                    {codes.map((c) => (
                      <th key={c} className="text-right px-3 py-2 whitespace-nowrap">
                        {ssStoreLabel(c)}
                      </th>
                    ))}
                    <th className="text-right px-3 py-2">Total</th>
                    <th className="text-right px-3 py-2 whitespace-nowrap" title="Action split as seen in the last-hits sample (max 20 per store) — a hint, not a total">
                      in last 20 hits: allow / monitor / block
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((r) => (
                    <tr key={r.reason} className="border-t border-border">
                      <td className="px-3 py-1.5 font-mono text-[11.5px]">{r.reason}</td>
                      {codes.map((c) => (
                        <td key={c} className="px-3 py-1.5 text-right">
                          {r.perStore[c] ?? ""}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-right font-medium">{r.total}</td>
                      <td className="px-3 py-1.5 text-right text-text-dim">
                        {r.byAction.allow} / {r.byAction.monitor} / {r.byAction.block}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-text-faint -mt-3 mb-5">
              <code>unknown-ext:*</code> reasons: look the extension ID up and add it to the candidates list.
            </p>

            {/* Daily bars — plain divs */}
            <h2 className="text-[13px] font-semibold mb-2">Per day (UTC)</h2>
            <div className="rounded-lg border border-border bg-bg-elev p-3 mb-5">
              {daily.map((d) => {
                const total = d.monitor + d.block + d.allow;
                const w = (n: number) => `${Math.max(0, (n / dailyMax) * 100)}%`;
                return (
                  <div key={d.day} className="flex items-center gap-3 text-[11.5px] py-0.5">
                    <span className="w-[80px] shrink-0 text-text-dim font-mono">{d.day}</span>
                    <div className="flex-1 h-3 rounded bg-surface overflow-hidden flex">
                      <div className="h-full bg-accent" style={{ width: w(d.monitor) }} title={`${d.monitor} monitor`} />
                      <div className="h-full bg-danger" style={{ width: w(d.block) }} title={`${d.block} block`} />
                      <div className="h-full bg-text-faint/40" style={{ width: w(d.allow) }} title={`${d.allow} allow`} />
                    </div>
                    <span className="w-[120px] shrink-0 text-right text-text-dim">
                      {total} <span className="text-text-faint">({d.monitor}m / {d.block}b / {d.allow}a)</span>
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Last hits */}
            <h2 className="text-[13px] font-semibold mb-2">Last hits</h2>
            <div className="overflow-x-auto rounded-lg border border-border mb-5">
              <table className="w-full text-[12.5px]">
                <thead className="bg-surface text-text-dim">
                  <tr>
                    <th className="text-left px-3 py-2">Time (UTC)</th>
                    <th className="text-left px-3 py-2">Store</th>
                    <th className="text-left px-3 py-2">Action</th>
                    <th className="text-left px-3 py-2">Reason</th>
                    <th className="text-left px-3 py-2">Ref host</th>
                    <th className="text-left px-3 py-2">Path</th>
                    <th className="text-left px-3 py-2">Phase</th>
                    <th className="text-left px-3 py-2">Repeat</th>
                  </tr>
                </thead>
                <tbody>
                  {lastHits.map((h, i) => (
                    <tr key={`${h.ts}-${i}`} className="border-t border-border">
                      <td className="px-3 py-1.5 whitespace-nowrap">{fmtHitTime(h.ts)}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{ssStoreLabel(h.store)}</td>
                      <td className={`px-3 py-1.5 ${h.ss_action === "block" ? "text-danger font-medium" : ""}`}>
                        {h.ss_action}
                        {h.ss_tier ? <span className="text-text-faint"> ({h.ss_tier})</span> : null}
                        {h.ss_pt === 1 ? (
                          <span className="text-warning" title="preview theme: sent from an unpublished theme (theme.role != 'main')">
                            {" "}
                            pt
                          </span>
                        ) : null}
                      </td>
                      <td
                        className="px-3 py-1.5 font-mono text-[11.5px]"
                        title={[h.ss_signals ? `signals: ${h.ss_signals}` : "", h.ss_info ? `info: ${h.ss_info}` : ""]
                          .filter(Boolean)
                          .join("\n")}
                      >
                        {h.ss_reason || "none"}
                        {h.ss_info ? <span className="text-text-faint"> ⓘ</span> : null}
                      </td>
                      <td className="px-3 py-1.5">{h.ss_ref_host || ""}</td>
                      <td className="px-3 py-1.5 font-mono text-[11.5px] max-w-[260px] truncate" title={h.ss_path}>
                        {h.ss_path}
                      </td>
                      <td className="px-3 py-1.5">{h.ss_phase}</td>
                      <td className="px-3 py-1.5">{h.ss_repeat === 1 ? "yes" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Checklist — mirrors README "Wekelijkse 5 minuten" + the block phase + rollback. */}
        {data && (
          <div className="rounded-lg border border-border bg-bg-elev p-4 text-[12px]">
            <h2 className="text-[13px] font-semibold mb-2">
              Wekelijkse 5 minuten ({SS_MONITOR_DAYS} dagen Monitor vóór je omzet)
            </h2>
            <ol className="list-decimal pl-5 space-y-1 text-text-dim">
              <li>
                <strong className="text-text">{SS_MONITOR_DAYS} dagen data in Monitor</strong> per winkel voordat je
                naar Blokkeren gaat (twee advertentiecycli). De regel per winkel hierboven wordt groen met een ✓
                zodra dat gehaald is.
              </li>
              <li>
                <strong className="text-text">&ldquo;Buyers in flagged sessions&rdquo;</strong> (koper in
                gemarkeerde sessie) <strong className="text-text">moet 0 zijn</strong> — anders NIET omzetten:
                eerst de order openen en uitzoeken welk signaal het was (zie de uitleg onder de rode tabel).
                Eén rode tegel is geen bewijs: de beacon-URL is publiek, dus eerst het ruwe log bekijken.
              </li>
              <li>
                <strong className="text-text">Would-be blocks &lt; 0,5 % van de sessies</strong> van de winkel —
                sessies: Shopify Admin › Analytics › Sessions over dezelfde periode. Voorbeeld: 4 000 sessies →
                hooguit 20 would-be blocks.
              </li>
              <li>
                <strong className="text-text">Minstens 1 hit</strong> per live winkel — een lege pijplijn telt niet
                als &ldquo;schoon&rdquo;. Geen hits? Test de pijp zelf (zie de tekst bij &ldquo;No records&rdquo;).
              </li>
              <li>
                <code>unknown-ext:*</code> in de redenen → extensie-ID opzoeken en toevoegen aan de kandidatenlijst;
                nieuwe <code>app.*</code>-verwijzers eerst in &ldquo;Extra tool-domeinen (eerst alleen meten)&rdquo;.
              </li>
              <li>
                <code>ss_pt</code>-tegel rood op een live winkel terwijl je géén duplicaat test = het thema meldt
                zich niet meer als &lsquo;main&rsquo;, het shield staat feitelijk uit — meteen uitzoeken.
              </li>
            </ol>

            <h3 className="text-[12.5px] font-semibold mt-4 mb-1">Omzetten naar Blokkeren</h3>
            <p className="text-text-dim">
              Eén winkel tegelijk: <strong className="text-text">DK eerst, 7 dagen</strong>; dan FR/FI; dan NL →
              .com → DE, één per dag. Dagelijks: &ldquo;502s actually shown&rdquo; ≈ de eerdere would-be blocks,
              geen mail met &ldquo;502&rdquo;, geen afgekeurde advertenties, Merchant Center › Diagnostics schoon,
              conversie normaal.
            </p>

            <h3 className="text-[12.5px] font-semibold mt-3 mb-1 text-danger">
              Meteen terugdraaien (Stand = Monitor, duurt seconden) als:
            </h3>
            <ul className="list-disc pl-5 space-y-0.5 text-text-dim">
              <li>een klantmail &ldquo;502&rdquo; noemt</li>
              <li>de conversie op een dag &gt; 20 % daalt</li>
              <li>Merchant Center &ldquo;landing page not working&rdquo; meldt</li>
              <li>Meta &ldquo;non-functional landing page&rdquo; meldt</li>
              <li>een rode koper-rij verschijnt bij een winkel die in Blokkeren staat</li>
            </ul>
            <p className="text-text-dim mt-2">
              Beacon-URL roteren? Eerst álle winkels op Monitor, dan roteren, dan meteen plakken — een winkel
              in Blokkeren met de oude URL blokkeert blind (teller <code>token</code> hieronder loopt dan op).
            </p>

            {data.dropped && (
              <p className="text-[11px] text-text-faint mt-3">
                Dropped since server start:{" "}
                {Object.entries(data.dropped)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => `${k} ${n}`)
                  .join(", ") || "none"}{" "}
                · accepted {data.accepted_since_start}
                {data.limits
                  ? ` · limits ${data.limits.per_ip_min}/min and ${data.limits.per_ip_day}/day per IP, ${data.limits.per_day}/day total, ${data.limits.retention_days} days kept`
                  : ""}
                <br />
                Legend: token = beacons with an old/wrong URL (re-paste the URL above) · off = kill switch on ·
                rate_ip / rate_day = flood protection · full = log file at its size cap · size / json / shape /
                error = malformed posts (ignore unless large).
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
