"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, SpyShieldSummary } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import {
  SS_STORE_ORDER,
  fmtHitTime,
  maxDailyTotal,
  mergedDaily,
  mergedLastHits,
  reasonMatrix,
  ssStoreCodes,
  ssStoreLabel,
} from "@/lib/spyShield";

type Days = 7 | 14 | 30;

/** Een KPI-tegel. `tone` kleurt de hele tegel: rood = stopcriterium geraakt,
 *  grijs = niet van toepassing (Light Supplier heeft geen orders hier). */
function Tile({
  label,
  value,
  hint,
  tone = "normal",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "normal" | "danger" | "muted";
}) {
  const cls =
    tone === "danger"
      ? "border-danger/50 bg-danger/10 text-danger"
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

  // Light Supplier alleen geselecteerd → de koper-check kan daar niets zeggen.
  const buyersNa = store !== "all" && !(buyers?.supported_stores ?? ["dk", "fr", "fi"]).includes(store);
  const buyersValue = buyersNa ? "n/a" : buyers?.count === null || buyers?.count === undefined ? "?" : buyers.count;
  const buyersTone = buyersNa ? "muted" : (buyers?.count ?? 0) > 0 ? "danger" : "normal";

  const runSetup = async (rotate: boolean) => {
    if (rotate) {
      const ok = window.confirm(
        "Generate a NEW beacon URL? The current URL stops working immediately and every " +
          "theme (6 stores) that has it pasted falls back from Block to Monitor until you " +
          "paste the new one. Continue?"
      );
      if (!ok) return;
    }
    setSetupBusy(true);
    setSetupMsg(null);
    try {
      const r = await api.spyShieldSetup(rotate);
      if (r.error) throw new Error(r.error);
      setSetupMsg(rotate ? "New beacon URL generated — paste it in all six themes." : "Beacon URL generated.");
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
              behind the fake 502 page.
            </p>
          </div>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value) as Days)}
            className="text-[12px] bg-surface border border-border rounded px-2 py-1"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
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
                      Paste this in Theme settings › Spy Shield › Beacon-URL (each of the 6 stores). Block
                      mode in the theme refuses to switch on until this URL is filled in.
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

        {/* KPI tiles */}
        {data && totals && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
            <Tile label="Monitor hits" value={totals.by_action.monitor} hint={`${days} days`} />
            <Tile label="Block hits" value={totals.by_action.block} hint={`${totals.block_tier_hits} block-tier signals`} />
            <Tile label="Unique browsers" value={totals.unique_browsers} hint={`${totals.repeat_hits} came back with the same signal`} />
            <Tile
              label="Buyers in flagged sessions"
              value={buyersValue}
              tone={buyersTone}
              hint={
                buyersNa
                  ? "Buyer check covers Vionna DK/FR/FI only"
                  : buyers?.count === null
                    ? "orders not readable — not proof of 0"
                    : (buyers?.count ?? 0) > 0
                      ? "STOP: do not switch to Block, investigate first"
                      : "must stay 0 before switching to Block"
              }
            />
            <Tile
              label="Preview-theme records (ss_pt)"
              value={totals.pt_alarm}
              tone={totals.pt_alarm > 0 ? "danger" : "normal"}
              hint={
                totals.pt_alarm > 0
                  ? "shield effectively off on a live store — check theme.role"
                  : "0 = the live theme sees itself as main"
              }
            />
          </div>
        )}

        {buyers?.note && data && (
          <p className="text-[11.5px] text-text-dim mb-4">{buyers.note}</p>
        )}

        {buyers && buyers.orders.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-danger/40 mb-5">
            <table className="w-full text-[12.5px]">
              <thead className="bg-danger/10 text-danger">
                <tr>
                  <th className="text-left px-3 py-2">Order</th>
                  <th className="text-left px-3 py-2">Store</th>
                  <th className="text-left px-3 py-2">Ordered</th>
                  <th className="text-left px-3 py-2">Landing path</th>
                  <th className="text-left px-3 py-2">Signal</th>
                  <th className="text-left px-3 py-2">Signal at</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty state — an empty pipeline must never read as "clean". */}
        {loading && !data ? (
          <p className="text-[12.5px] text-text-faint">Loading…</p>
        ) : empty ? (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-3 mb-5 text-[12.5px]">
            <strong>No records have arrived yet</strong> in the last {days} days
            {store !== "all" ? ` for ${ssStoreLabel(store)}` : ""}. That is not the same as
            &ldquo;no spies&rdquo;: it means the theme is not sending. Check, per store, that
            (1) Theme settings › Spy Shield › Stand is <em>Monitor</em> (not <em>Uit</em>) and (2) the
            beacon URL above is pasted in Theme settings › Spy Shield › Beacon-URL. A live store must
            show at least 1 hit before it can ever be switched to Block.
          </div>
        ) : null}

        {data && totals && totals.total > 0 && (
          <>
            <p className="text-[11.5px] text-text-dim mb-4">
              {totals.total} records · last hit {fmtHitTime(totals.last_hit_at ?? undefined) || "—"} ·
              {" "}{codes.map((c) => `${ssStoreLabel(c)} ${stores[c].total}`).join(" / ")}
            </p>

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
                      allow / monitor / block*
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
              * from the last-hits sample only. <code>unknown-ext:*</code> reasons: look the extension ID up
              and add it to the candidates list.
            </p>

            {/* Daily bars — plain divs */}
            <h2 className="text-[13px] font-semibold mb-2">Per day</h2>
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
                    <th className="text-left px-3 py-2">Time</th>
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
                        {h.ss_pt === 1 ? <span className="text-danger"> pt</span> : null}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[11.5px]">{h.ss_reason || "none"}</td>
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

        {/* Weekly checklist — mirrors README "Wekelijkse 5 minuten". */}
        {data && (
          <div className="rounded-lg border border-border bg-bg-elev p-4 text-[12px]">
            <h2 className="text-[13px] font-semibold mb-2">Wekelijkse 5 minuten (14 dagen Monitor vóór je omzet)</h2>
            <ol className="list-decimal pl-5 space-y-1 text-text-dim">
              <li>
                <strong className="text-text">14 dagen Monitor</strong> per winkel voordat je naar Blokkeren gaat
                (twee advertentiecycli).
              </li>
              <li>
                <strong className="text-text">&ldquo;Buyers in flagged sessions&rdquo; moet 0 zijn</strong> — anders NIET
                omzetten, eerst uitzoeken welke order en welk signaal.
              </li>
              <li>
                <strong className="text-text">Minstens 1 hit</strong> per live winkel — een lege pijplijn telt niet als
                &ldquo;schoon&rdquo; (dan staat de stand op Uit of mist de beacon-URL).
              </li>
              <li>
                <code>unknown-ext:*</code> in de redenen → extensie-ID opzoeken en toevoegen aan de kandidatenlijst;
                nieuwe <code>app.*</code>-verwijzers eerst in &ldquo;Extra tool-domeinen (alleen meten)&rdquo;.
              </li>
              <li>
                <code>ss_pt</code>-tegel rood op een live winkel = het thema meldt zich niet meer als
                &lsquo;main&rsquo;, het shield staat feitelijk uit — meteen uitzoeken.
              </li>
            </ol>
            {data.dropped && (
              <p className="text-[11px] text-text-faint mt-3">
                Dropped since server start: {Object.entries(data.dropped).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}
                {" "}· accepted {data.accepted_since_start}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
