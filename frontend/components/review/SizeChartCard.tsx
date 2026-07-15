"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Field, Label } from "@/components/ui/Field";
import { useProduct } from "@/lib/product";
import { api, type SizeChart } from "@/lib/api";

/** Parse a pasted table (from Excel / Google Sheets / a website) into a SizeChart.
 *  Rows = newlines; cells = TAB, then ";", then ",", then 2+ spaces. First row = headers. */
export function parsePastedChart(text: string): SizeChart | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const splitRow = (l: string): string[] => {
    if (l.includes("\t")) return l.split("\t");
    if (l.includes(";")) return l.split(";");
    if (l.includes(",")) return l.split(",");
    return l.split(/\s{2,}/);
  };
  const grid = lines.map((l) => splitRow(l).map((c) => c.trim()));
  const width = Math.max(...grid.map((r) => r.length));
  if (width < 2) return null;
  const norm = grid.map((r) => {
    const row = [...r];
    while (row.length < width) row.push("");
    return row.slice(0, width);
  });
  return { headers: norm[0], rows: norm.slice(1) };
}

/** Review-step card: shows the size chart the import found (if any) and lets the
 *  employee paste one in when it didn't — publishes to custom.size_chart. */
export function SizeChartCard() {
  const { data, patch } = useProduct();
  const chart = data.sizeChart;
  const hasChart = !!chart && chart.rows.length > 0;
  // A chart clearly EXISTS on the competitor page but we couldn't read it (unknown
  // app). Offer a one-click "Notify" so support gets added — not shown when there
  // is genuinely no chart.
  const unread = !hasChart && data.sizeChartStatus === "unread";

  const [paste, setPaste] = useState("");
  const [editing, setEditing] = useState(false);
  const [notify, setNotify] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const preview = paste.trim() ? parsePastedChart(paste) : null;

  const sendNotify = async () => {
    setNotify("sending");
    try {
      const r = await api.reportBug({
        title: `Size chart reader needed: ${data.sizeChartHint ?? "unknown app"}`,
        description:
          `The import detected a size chart on the competitor page but couldn't read it ` +
          `automatically (${data.sizeChartHint ?? "unknown app/method"}). Please add support ` +
          `for this so future imports capture it. Product: ${data.name || "?"}. URL below.`,
        page_url: data.competitorUrl || undefined,
        diagnostics: {
          competitor_url: data.competitorUrl || null,
          detected_colors: data.canonicalColors ?? [],
          color_count: (data.canonicalColors ?? []).length,
          sizes: data.sizes ?? [],
          selected_stores: data.selectedStores ?? [],
          product_name: data.name || null,
        },
      });
      setNotify(r.success ? "sent" : "error");
    } catch {
      setNotify("error");
    }
  };

  const applyPaste = () => {
    const parsed = parsePastedChart(paste);
    if (!parsed) return;
    patch({ sizeChart: parsed });
    setPaste("");
    setEditing(false);
  };

  const showEditor = editing || !hasChart;

  return (
    <Card title="Size chart">
      {hasChart ? (
        <>
          <div className="overflow-x-auto rounded-[10px] border border-border">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr>
                  {chart!.headers.map((h, i) => (
                    <th
                      key={i}
                      className="border-b border-border px-2.5 py-1.5 bg-bg-elev-2 text-left font-medium text-text-dim"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chart!.rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, ci) => (
                      <td key={ci} className="border-b border-border px-2.5 py-1.5">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-[11px] text-accent">✓ Publishes to the size-guide popup</span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="text-[11px] text-text-dim hover:text-accent transition"
            >
              {editing ? "Cancel" : "Replace"}
            </button>
            <button
              type="button"
              onClick={() => patch({ sizeChart: null })}
              className="text-[11px] text-text-dim hover:text-danger transition"
            >
              Clear
            </button>
          </div>
        </>
      ) : unread ? (
        <div className="rounded-[10px] border border-warning/40 bg-warning/10 px-3 py-2.5 mb-3">
          <div className="text-[12px] text-text">
            ⚠ This product <strong>has a size chart</strong> on the competitor page, but we couldn&apos;t read
            it automatically{data.sizeChartHint ? ` (${data.sizeChartHint})` : ""}.
          </div>
          <div className="text-[11px] text-text-dim mt-1 leading-relaxed">
            Press <strong>Notify</strong> so we add support for reading it — it goes straight to the
            developer. You can still paste the chart manually below for this product.
          </div>
          <div className="mt-2">
            {notify === "sent" ? (
              <span className="text-[12px] text-accent">✓ Reported — thanks! We&apos;ll add support for this.</span>
            ) : (
              <button
                type="button"
                onClick={sendNotify}
                disabled={notify === "sending"}
                className="px-3 h-8 rounded-[8px] bg-warning text-white text-[12px] font-medium disabled:opacity-50 hover:opacity-90 transition active:scale-95"
              >
                {notify === "sending" ? "Sending…" : notify === "error" ? "↻ Retry notify" : "🔔 Notify"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="text-[12px] text-text-faint mb-1">
          The import found no size chart. <strong className="text-text-dim">No problem:</strong> at
          publish, the store&apos;s standard chart for this product type is applied automatically, so
          the product always gets a size-guide popup. Prefer the competitor&apos;s exact chart? Paste
          it below and that one is used instead.
        </div>
      )}

      {showEditor && (
        <Field>
          <Label hint="(copy a table from Excel/Sheets/website — first row = headers)">
            Paste size chart
          </Label>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={5}
            spellCheck={false}
            placeholder={"Size\tBust\tWaist\nS\t88\t68\nM\t92\t72\nL\t96\t76"}
            className="w-full px-3 py-2 rounded-[10px] bg-bg-elev-2 border border-border text-[12px] font-mono leading-relaxed focus:outline-none focus:border-accent focus:ring-3 focus:ring-[var(--accent-soft)] resize-y"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={applyPaste}
              disabled={!preview}
              className="px-3 h-9 flex items-center justify-center rounded-[10px] bg-accent text-white text-[13px] font-medium disabled:opacity-40 hover:opacity-90 transition active:scale-95"
            >
              {hasChart ? "Replace chart" : "Add chart"}
            </button>
            {preview ? (
              <span className="text-[11px] text-text-dim">
                {preview.headers.length} columns · {preview.rows.length} rows
              </span>
            ) : paste.trim() ? (
              <span className="text-[11px] text-danger">Couldn’t parse — need ≥2 rows and ≥2 columns</span>
            ) : null}
          </div>
        </Field>
      )}
    </Card>
  );
}
