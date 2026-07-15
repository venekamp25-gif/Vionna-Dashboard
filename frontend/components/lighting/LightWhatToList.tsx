"use client";

import { useEffect, useState } from "react";
import { api, LIGHT_STORE_CONFIG, type LightStore } from "@/lib/api";

type LightType = {
  seed: string;
  label: string;
  volume: number | null;
  recommended?: boolean;
  meets_doc_volume?: boolean;
  bucket?: "now" | "soon" | "evergreen" | "off";
  seasonality?: {
    peak_month?: string;
    push_from_month?: string;
    trend?: string;
    seasonal?: boolean;
  } | null;
};

const BUCKET_COPY: Record<string, { label: string; tone: string }> = {
  now: { label: "List now", tone: "text-accent border-accent/40 bg-accent/10" },
  soon: { label: "Start soon", tone: "text-warning border-warning/40 bg-warning/10" },
  evergreen: { label: "All year", tone: "text-text-dim border-border bg-bg-elev-2" },
  off: { label: "Out of season", tone: "text-text-faint border-border bg-bg-elev-2" },
};

/** Step ① of the lighting research funnel: which lamp types are worth listing in
 *  this market right now. Same engine as fashion — the seasonality model is pure
 *  statistics on 12 months of search history, so it reads lamps as happily as
 *  dresses. Only the market tables and the LLM prompts differ. */
export function LightWhatToList({ market }: { market: LightStore }) {
  const [types, setTypes] = useState<LightType[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  const run = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.whatToList({ store: market, per_type: 5, force });
      if (!r.configured) {
        setNotConfigured(true);
        setTypes(null);
        return;
      }
      setNotConfigured(false);
      setTypes((r.types ?? []) as LightType[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setTypes(null);
    setError(null);
  }, [market]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => run(false)}
          disabled={loading}
          className="px-3 h-8 rounded-[10px] bg-accent text-on-accent text-[12px] font-medium disabled:opacity-40 hover:opacity-90 transition"
        >
          {loading ? "Checking demand…" : types ? "↻ Refresh" : `What sells in ${LIGHT_STORE_CONFIG[market].label}?`}
        </button>
        {types && (
          <span className="text-[11px] text-text-faint">{types.length} lamp types ranked by demand</span>
        )}
      </div>

      {notConfigured && (
        <p className="text-[12px] text-text-faint">
          Keyword research isn&apos;t switched on for this server yet, so demand data is unavailable.
        </p>
      )}
      {error && <p className="text-[12px] text-danger">{error}</p>}

      {types && types.length === 0 && (
        <p className="text-[12px] text-text-faint">
          No types came back — that usually means the search volumes for this market fell below the
          threshold rather than that there&apos;s no demand.
        </p>
      )}

      {types && types.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="bg-bg-elev-2">
                <th className="text-left font-medium text-text-dim px-3 py-2">Lamp type</th>
                <th className="text-left font-medium text-text-dim px-3 py-2">Searched as</th>
                <th className="text-right font-medium text-text-dim px-3 py-2">Searches / month</th>
                <th className="text-left font-medium text-text-dim px-3 py-2">Timing</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => {
                const b = BUCKET_COPY[t.bucket ?? "evergreen"] ?? BUCKET_COPY.evergreen;
                return (
                  <tr key={t.seed} className="border-t border-border">
                    <td className="px-3 py-2 text-text">
                      {t.recommended && (
                        <span className="mr-1 text-accent" title="Strongest pick right now">
                          ★
                        </span>
                      )}
                      {t.label}
                    </td>
                    <td className="px-3 py-2 text-text-dim">{t.seed}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-dim">
                      {t.volume != null ? t.volume.toLocaleString("en-US") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${b.tone}`}>
                        {b.label}
                      </span>
                      {t.seasonality?.seasonal && t.seasonality.peak_month && (
                        <span className="ml-1.5 text-[10.5px] text-text-faint">
                          peaks {t.seasonality.peak_month}
                          {t.seasonality.push_from_month ? ` · start ${t.seasonality.push_from_month}` : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10.5px] text-text-faint mt-3 leading-relaxed">
        Demand and seasonality come from real Google search volume for {LIGHT_STORE_CONFIG[market].language}.
        Lighting peaks in the dark months and around Black Friday, outdoor lighting in spring — the timing
        column already accounts for that, and &ldquo;start&rdquo; is roughly five weeks before the climb begins.
        Finding competitor stores and their bestsellers is the next piece to be built for lighting.
      </p>
    </div>
  );
}
