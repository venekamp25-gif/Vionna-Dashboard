"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { api, ScrapedProduct } from "@/lib/api";

interface Props {
  open: boolean;
  /** The original URL the user pasted in Input — we suggest its `.json` variant. */
  originalUrl: string;
  onClose: () => void;
  /** Fires with the validated product. Parent should then continue the
   *  Generate flow as if `/api/scrape` had returned this. */
  onSuccess: (product: NonNullable<ScrapedProduct["product"]>) => void;
}

/**
 * Escape hatch when the dashboard's scraper hits a Cloudflare / WAF block
 * (datacenter-IP reputation issue — see the Cloudflare paths in /api/scrape).
 *
 * Walks the user through fetching the .json URL from their own browser
 * (residential IP = no block), copying the response, and pasting it back.
 * Posts to /api/scrape_manual which validates the JSON and returns it in
 * the same shape /api/scrape would have.
 */
export function ManualPasteModal({ open, originalUrl, onClose, onSuccess }: Props) {
  const [pasted, setPasted] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  // Derive the .json variant of the URL (stripping any locale prefix is left
  // to the backend; the user just needs SOMETHING fetchable in their browser).
  let jsonUrl = originalUrl.trim();
  // If it doesn't end in .json, append it before any query/fragment.
  try {
    const u = new URL(jsonUrl);
    if (!u.pathname.endsWith(".json")) u.pathname = u.pathname.replace(/\/+$/, "") + ".json";
    u.search = "";
    u.hash = "";
    jsonUrl = u.toString();
  } catch {
    // If URL parsing fails, fall back to a naive append
    if (!jsonUrl.endsWith(".json")) jsonUrl = jsonUrl.replace(/\?.*$/, "").replace(/#.*$/, "") + ".json";
  }

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(jsonUrl);
    } catch {
      // Some browsers without clipboard API — fall back to manual selection
    }
  };

  const submit = async () => {
    setError(null);
    if (!pasted.trim()) {
      setError("Paste the JSON from your browser before clicking 'Use this JSON'.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.scrapeManual(pasted);
      if (r.error || !r.product) {
        throw new Error(r.error || "Server rejected the pasted JSON.");
      }
      onSuccess(r.product);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-12 px-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-bg-elev border border-border rounded-2xl shadow-2xl mb-12"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-[16px] font-semibold text-text">
              Paste the product JSON manually
            </h2>
            <p className="text-[12px] text-text-faint mt-0.5 max-w-md">
              This shop's anti-bot protection is blocking our scraper, but you
              can still fetch the data from your own browser and paste it back.
              Takes about 30 seconds.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-faint hover:text-text text-xl px-2 shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Step 1 — open URL */}
          <Step number={1} title="Open this URL in a new browser tab">
            <p className="text-[12px] text-text-faint mb-2 leading-relaxed">
              You should see a wall of text starting with{" "}
              <code className="bg-bg-elev-2 px-1 rounded text-[11px]">
                {"{"}&quot;product&quot;:{"{"}
              </code>
              ...
            </p>
            <div className="flex gap-2 items-stretch">
              <input
                type="text"
                value={jsonUrl}
                readOnly
                className="flex-1 bg-bg-elev-2 border border-border rounded-[10px] px-3 py-2 text-[12px] text-text-dim font-mono"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button variant="secondary" size="sm" onClick={copyUrl}>
                Copy URL
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.open(jsonUrl, "_blank", "noopener,noreferrer")}
              >
                Open ↗
              </Button>
            </div>
          </Step>

          {/* Step 2 — copy */}
          <Step number={2} title="Select all the text on that page and copy it">
            <p className="text-[12px] text-text-faint leading-relaxed">
              <strong className="text-text">Ctrl + A</strong> to select all, then{" "}
              <strong className="text-text">Ctrl + C</strong> to copy. The whole
              JSON blob, from the first{" "}
              <code className="bg-bg-elev-2 px-1 rounded text-[11px]">{"{"}</code>{" "}
              to the last{" "}
              <code className="bg-bg-elev-2 px-1 rounded text-[11px]">{"}"}</code>.
            </p>
          </Step>

          {/* Step 3 — paste */}
          <Step number={3} title="Paste the copied text below">
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={8}
              placeholder='Paste the entire JSON here. It should start with {"product":{"id":...'
              spellCheck={false}
              className="w-full bg-bg-elev-2 border border-border rounded-[10px] px-3 py-2 text-[12px] font-mono text-text placeholder:text-text-faint hover:border-border-hover focus:outline-none focus:border-accent focus:ring-3 focus:ring-[var(--accent-soft)] resize-y leading-relaxed"
            />
            <div className="text-[11px] text-text-faint mt-1 text-right">
              {pasted.length.toLocaleString()} chars
            </div>
          </Step>

          {/* Note about multi-colour */}
          <div className="text-[11px] text-text-faint bg-bg-elev-2 border border-border rounded-[10px] px-3 py-2.5 leading-relaxed">
            <strong className="text-text">Heads up:</strong> manual paste only
            captures the colour at this URL. For multi-colour shops where each
            colour is its own product (Billy J, SKIMS, meshki…), you have to
            either repeat this paste per colour, or just import + publish each
            colour separately.
          </div>

          {error && (
            <div className="px-3 py-2.5 rounded-md bg-danger/15 border border-danger/40 text-[12px] text-danger">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-bg-elev-2 rounded-b-2xl">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={submitting}>
            {submitting ? "Validating…" : "Use this JSON →"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-7 h-7 rounded-full bg-accent text-on-accent text-[12px] font-bold flex items-center justify-center">
        {number}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-text mb-1.5">{title}</div>
        {children}
      </div>
    </div>
  );
}
