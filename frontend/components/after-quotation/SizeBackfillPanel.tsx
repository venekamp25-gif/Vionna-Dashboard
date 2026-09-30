"use client";

/**
 * Sizes from competitors — backfill for listings still on the old XS–XL
 * default (v1.323). Check first (a dry run: each colour group's competitor page
 * is read, nothing is written), then apply the ticked rows. Every group goes
 * through the normal After Quotation apply: own backup, history and Undo.
 * Groups that already sold start unticked — their variants are linked at the
 * fulfilment agent, and removing or adding sizes can break that link.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { aqApi, aqSizesApi, type AqJob, type AqSizeReport, type AqSizeRow } from "@/lib/api";

const STATUS_LABEL: Record<string, string> = {
  change: "Will change",
  same: "Already right",
  no_source: "No competitor page on file",
  gone: "Competitor page is gone",
  failed: "Competitor page couldn't be read (try again later)",
};
const SOURCE_LABEL: Record<string, string> = {
  competitor: "from the competitor",
  "converted-uk": "converted from UK/AU sizes",
  "one-size": "One Size (accessory)",
  default: "default — competitor has no sizes",
  "shoe-default": "default shoe sizes — competitor has none",
};

const thumb = (url: string) => (url ? `${url}${url.includes("?") ? "&" : "?"}width=96` : "");
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SizeBackfillPanel({ onDone }: { onDone?: () => void }) {
  const [report, setReport] = useState<AqSizeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<AqJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showOthers, setShowOthers] = useState(false);

  const loadReport = useCallback(async () => {
    try {
      const r = await aqSizesApi.report();
      setReport(r);
      // unsold groups ticked, sold ones not (fulfilment link — see the header)
      setPicked(new Set(r.rows.filter((x) => x.status === "change" && x.orders === 0).map((x) => x.key)));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const poll = async (id: string) => {
    let misses = 0;
    for (let i = 0; i < 1200; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const j = await aqApi.job(id).catch(() => null);
      if (!j) {
        if (++misses >= 5) {
          setErr("Lost contact with the job (server restarted?) — reload this page to see what landed.");
          return null;
        }
        continue;
      }
      misses = 0;
      setJob(j);
      if (j.status !== "running") return j;
    }
    return null;
  };

  const runCheck = async () => {
    setErr(null);
    setJob(null);
    try {
      const { job_id } = await aqSizesApi.check();
      const done = await poll(job_id);
      if (done) await loadReport();
    } catch (e) {
      setErr(errText(e));
    }
  };

  const changes = useMemo(() => (report?.rows ?? []).filter((r) => r.status === "change"), [report]);
  const others = useMemo(() => (report?.rows ?? []).filter((r) => r.status !== "change"), [report]);
  const running = job?.status === "running";

  const runApply = async () => {
    const keys = changes.filter((r) => picked.has(r.key)).map((r) => r.key);
    if (!keys.length) return;
    const sold = changes.filter((r) => picked.has(r.key) && r.orders > 0).length;
    if (
      !window.confirm(
        `Change the sizes of ${keys.length} listing${keys.length === 1 ? "" : "s"} in every store?` +
          (sold ? `\n\n${sold} of them already sold — check the size links at your fulfilment agent afterwards.` : "") +
          "\n\nEach one is backed up first and can be undone from its listing page."
      )
    )
      return;
    setErr(null);
    setJob(null);
    try {
      const { job_id } = await aqSizesApi.apply(keys);
      const done = await poll(job_id);
      if (done) {
        onDone?.();
        await runCheck(); // what is left after this round
      }
    } catch (e) {
      setErr(errText(e));
    }
  };

  const toggle = (k: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <section className="bg-bg-elev border border-border rounded-2xl p-5 lg:p-6 space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold text-text">Sizes from competitors</h2>
        <p className="text-[12px] text-text-dim mt-0.5 leading-relaxed max-w-3xl">
          Until now every listing got XS–XL, whatever the competitor sold. This checks every listing that still has
          XS–XL (and shoes in clothing sizes) against the competitor page it was copied from — nothing is written until
          you apply. Listings that already sold start <strong>unticked</strong>: their sizes are linked at your
          fulfilment agent, so check those links if you change them.
        </p>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="secondary" size="sm" onClick={() => void runCheck()} disabled={running}>
          {running && job?.kind !== "apply" ? `Checking… ${job?.done ?? 0}/${job?.total || "?"}` : "Check listings still on XS–XL"}
        </Button>
        {report?.generated_at && (
          <span className="text-[11.5px] text-text-faint">
            Last check {new Date(report.generated_at).toLocaleString("en-GB")} ·{" "}
            {Object.entries(report.counts || {})
              .map(([k, n]) => `${n} ${STATUS_LABEL[k]?.toLowerCase() ?? k}`)
              .join(" · ")}
          </span>
        )}
      </div>
      {err && <div className="rounded-lg border border-danger/40 bg-danger/10 text-danger px-3 py-2 text-[12px]">{err}</div>}
      {loading && <p className="text-[12px] text-text-faint">Loading the last check…</p>}
      {!loading && !report?.generated_at && !running && (
        <p className="text-[12px] text-text-dim">No check run yet — press the button (takes 1–3 minutes).</p>
      )}

      {changes.length > 0 && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[12.5px] font-semibold text-text">{changes.length} listings would get the competitor&apos;s sizes</span>
            <button type="button" className="text-[11.5px] text-accent hover:underline" onClick={() => setPicked(new Set(changes.map((r) => r.key)))}>
              tick all
            </button>
            <button type="button" className="text-[11.5px] text-accent hover:underline" onClick={() => setPicked(new Set())}>
              untick all
            </button>
            <span className="flex-1" />
            <Button variant="publish" size="sm" onClick={() => void runApply()} disabled={running || picked.size === 0}>
              {running && job?.kind === "size_apply" ? `Writing… ${job.done}/${job.total}` : `Apply to ${[...picked].filter((k) => changes.some((r) => r.key === k)).length} ticked`}
            </Button>
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {changes.map((r) => (
              <SizeRow key={r.key} r={r} on={picked.has(r.key)} toggle={() => toggle(r.key)} />
            ))}
          </ul>
        </>
      )}

      {others.length > 0 && (
        <details open={showOthers} onToggle={(e) => setShowOthers((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-[12px] text-text-dim hover:text-accent">
            {others.length} other listings (already right, no competitor page, page gone, couldn&apos;t be read)
          </summary>
          <ul className="mt-2 space-y-1 text-[11.5px] text-text-dim">
            {others.map((r) => (
              <li key={r.key}>
                <span className="text-text">{r.name}</span> · {STATUS_LABEL[r.status] ?? r.status}
                {r.competitor_url && (
                  <>
                    {" · "}
                    <a className="text-accent hover:underline" href={r.competitor_url} target="_blank" rel="noreferrer">
                      competitor page
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {job && (job.kind === "size_apply" || job.status !== "running") && job.log.length > 0 && (
        <ul className="text-[11.5px] space-y-0.5 max-h-60 overflow-y-auto rounded-xl border border-border p-3">
          {job.log.slice(-200).map((l, i) => (
            <li key={i} className={l.ok ? "text-text-dim" : "text-danger"}>
              {l.ok ? "✓" : "✕"} {l.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SizeRow({ r, on, toggle }: { r: AqSizeRow; on: boolean; toggle: () => void }) {
  return (
    <li className="flex items-start gap-3 p-3">
      <input type="checkbox" checked={on} onChange={toggle} className="mt-1 h-4 w-4 accent-[var(--accent)]" aria-label={`Apply to ${r.name}`} />
      {r.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb(r.image)} alt="" loading="lazy" className="w-11 h-11 rounded-md object-cover bg-bg-elev-2 shrink-0" />
      ) : (
        <div className="w-11 h-11 rounded-md bg-bg-elev-2 shrink-0" />
      )}
      <div className="min-w-0 flex-1 text-[12px]">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-semibold text-text">{r.name}</span>
          <span className="text-text-faint">{r.cat}</span>
          {r.orders > 0 && (
            <span className="text-[10.5px] px-1.5 rounded bg-warning/15 text-warning" title="Already sold: its sizes are linked at your fulfilment agent">
              sold {r.orders}×
            </span>
          )}
        </div>
        <div className="text-text-dim mt-0.5">
          <span className="line-through text-text-faint">{r.current.join(" ")}</span> → <strong className="text-text">{(r.proposed ?? []).join(" ")}</strong>
          {r.source && <span className="text-text-faint"> · {SOURCE_LABEL[r.source] ?? r.source}</span>}
        </div>
        {r.note && <div className="text-warning text-[11.5px]">{r.note}</div>}
        {r.competitor_url && (
          <a href={r.competitor_url} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline break-all">
            {r.competitor_url.replace(/^https?:\/\//, "").slice(0, 80)}
          </a>
        )}
      </div>
    </li>
  );
}
