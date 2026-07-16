"use client";

import { useState } from "react";
import {
  lightingApi,
  LIGHT_STORE_CONFIG,
  type LightStore,
  type LightStatusResponse,
  type LightCredentialEntry,
} from "@/lib/api";

const STORES: LightStore[] = ["nl", "de", "com"];
const TOKENS_PATH = String.raw`C:\Users\venek\Documents\lightsupplier-sync\tokens.json`;

/** Connects The Light Supplier's three Shopify stores to the Home Decor portal.
 *
 *  The credentials are pasted by the owner and go straight to their own droplet
 *  over HTTPS through a gated endpoint. They are deliberately held in plain
 *  component state only — never in the draft, so they can never reach
 *  localStorage — and the field is cleared the moment the save succeeds. */
export function LightStoreConnect({
  status,
  onChanged,
}: {
  status: LightStatusResponse | null;
  onChanged: (s: LightStatusResponse) => void;
}) {
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);

  const anyConfigured = (status?.ready?.length ?? 0) > 0;

  const test = async () => {
    setTesting(true);
    setError(null);
    try {
      onChanged(await lightingApi.status(true));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const connect = async () => {
    if (!paste.trim() || busy) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    let parsed: Record<string, LightCredentialEntry>;
    try {
      parsed = JSON.parse(paste);
    } catch {
      setError("That isn't valid JSON. Copy the whole file, including the outer { and }.");
      setBusy(false);
      return;
    }
    const found = STORES.filter((s) => parsed?.[s]);
    if (found.length === 0) {
      setError('No "nl", "de" or "com" store found in that JSON — is this the right file?');
      setBusy(false);
      return;
    }
    try {
      const r = await lightingApi.saveCredentials(
        Object.fromEntries(found.map((s) => [s, parsed[s]])) as Partial<Record<LightStore, LightCredentialEntry>>
      );
      if (r.error) throw new Error([r.error, ...(r.problems ?? [])].join(" · "));
      setPaste(""); // the tokens leave the browser the moment they're saved
      setSaved(r.saved ?? []);
      onChanged(await lightingApi.status(true));
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`rounded-2xl border p-5 ${
        anyConfigured ? "border-border bg-bg-elev" : "border-warning/40 bg-warning/10"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-text">
            {anyConfigured ? "The Light Supplier stores" : "Connect your lighting stores"}
          </h2>
          <p className="text-[12.5px] text-text-dim mt-1 leading-relaxed max-w-2xl">
            {anyConfigured
              ? "Publishing writes to these stores. “Connected” means the store actually answered — not just that a key is present."
              : "You can already import a lamp and write the copy. Publishing needs the Shopify credentials for The Light Supplier on the server first."}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {anyConfigured && (
            <button
              onClick={test}
              disabled={testing}
              className="px-3 h-8 rounded-[10px] border border-border text-[12px] text-text-dim hover:border-accent hover:text-accent disabled:opacity-40 transition"
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            className="px-3 h-8 rounded-[10px] bg-accent text-on-accent text-[12px] font-medium hover:opacity-90 transition"
          >
            {open ? "Cancel" : anyConfigured ? "Update keys" : "Connect stores"}
          </button>
        </div>
      </div>

      {/* Per-store state */}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {STORES.map((s) => {
          const st = status?.stores?.[s];
          const probed = status?.probed;
          const good = st?.connected === true;
          const bad = probed && st?.configured && st?.connected === false;
          return (
            <div key={s} className="rounded-xl border border-border bg-bg-elev-2 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-medium text-text">
                  {LIGHT_STORE_CONFIG[s].flag} {LIGHT_STORE_CONFIG[s].label}
                </span>
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                    good
                      ? "text-green-600 dark:text-green-400 border-green-600/40 bg-green-600/10"
                      : bad
                        ? "text-danger border-danger/40 bg-danger/10"
                        : st?.configured
                          ? "text-text-dim border-border"
                          : "text-text-faint border-border"
                  }`}
                >
                  {good ? "✓ connected" : bad ? "✗ failed" : st?.configured ? "key saved" : "not connected"}
                </span>
              </div>
              <p className="text-[10.5px] text-text-faint mt-1 truncate" title={st?.detail ?? st?.shop ?? ""}>
                {st?.detail ?? st?.shop ?? "—"}
              </p>
              {st?.auth === "client_credentials" && (
                <p className="text-[10px] text-text-faint mt-0.5">app key · token minted per run</p>
              )}
            </div>
          );
        })}
      </div>

      {saved && saved.length > 0 && !open && (
        <p className="text-[11.5px] text-accent mt-3">✓ Saved for: {saved.join(", ").toUpperCase()}</p>
      )}

      {open && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-[12px] text-text-dim leading-relaxed">
            Open this file on your PC, copy <strong>everything</strong> in it, and paste it below:
          </p>
          <code className="block mt-1.5 text-[11px] text-text-dim bg-bg-elev-2 border border-border rounded-lg px-2.5 py-1.5 overflow-x-auto">
            {TOKENS_PATH}
          </code>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={6}
            spellCheck={false}
            autoComplete="off"
            placeholder={'{\n  "nl":  { "shop": "….myshopify.com", "token": "…" },\n  "com": { "shop": "….myshopify.com", "token": "…" },\n  "de":  { "shop": "….myshopify.com", "client_id": "…", "client_secret": "…", "auth": "client_credentials" }\n}'}
            className="w-full mt-3 px-3 py-2 rounded-[10px] bg-bg-elev-2 border border-border text-[11.5px] font-mono leading-relaxed focus:outline-none focus:border-accent resize-y"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={connect}
              disabled={busy || !paste.trim()}
              className="px-4 h-9 rounded-[10px] bg-accent text-on-accent text-[13px] font-medium disabled:opacity-40 hover:opacity-90 transition"
            >
              {busy ? "Connecting…" : "Connect & test"}
            </button>
            <span className="text-[10.5px] text-text-faint">
              Goes straight to your own server over HTTPS. Never stored in this browser, never logged.
            </span>
          </div>
        </div>
      )}

      {error && <p className="text-[12px] text-danger mt-3">{error}</p>}
    </div>
  );
}
