"use client";

import { useEffect, useState } from "react";
import { useToneReferences, ToneReferences } from "@/lib/toneReference";
import { StoreKey, STORE_CONFIG, STORE_KEYS } from "@/lib/store";
import { Button } from "@/components/ui/Button";
import { api, backendAuthUrl } from "@/lib/api";
import { useProduct } from "@/lib/product";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Dashboard settings — currently houses the per-store Tone Reference editor.
 * Tone references are example descriptions from your own catalogue that Claude
 * uses as a style anchor on every generation, so newly written content
 * matches your existing voice instead of sounding generic.
 */
export function SettingsModal({ open, onClose }: Props) {
  const { refs, update } = useToneReferences();
  const { clearDraft } = useProduct();
  const [draft, setDraft] = useState<ToneReferences>({ dk: [], fr: [], fi: [] });
  const [activeTab, setActiveTab] = useState<StoreKey>("dk");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // DataForSEO keyword-research credentials
  const [dfsLogin, setDfsLogin] = useState("");
  const [dfsPassword, setDfsPassword] = useState("");
  const [dfsBusy, setDfsBusy] = useState(false);
  const [dfsStatus, setDfsStatus] = useState<{ configured: boolean; login_hint?: string } | null>(null);
  const [dfsMsg, setDfsMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    void api.keywordResearchStatus().then(setDfsStatus).catch(() => {});
  }, [open]);
  const saveDfs = async () => {
    if (!dfsLogin.trim() || !dfsPassword.trim()) {
      setDfsMsg("Enter both login and password.");
      return;
    }
    setDfsBusy(true);
    setDfsMsg(null);
    try {
      const r = await api.saveDataforseoCredentials({
        login: dfsLogin.trim(),
        password: dfsPassword.trim(),
      });
      if (r.ok || r.configured) {
        setDfsMsg("✓ Saved — keyword research is now active.");
        setDfsLogin("");
        setDfsPassword("");
        setDfsStatus({ configured: true });
      } else {
        setDfsMsg(r.error || "Could not save.");
      }
    } catch (e) {
      setDfsMsg(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setDfsBusy(false);
    }
  };

  const handleResetDraft = () => {
    if (!confirm(
      "Discard the current product and wipe the saved draft (both in this browser AND on the cloud)? " +
      "This cannot be undone."
    )) return;
    clearDraft();
    // Soft reload so the in-memory state resets too
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  // Sales-channel backfill state
  type ChannelResult = Awaited<ReturnType<typeof api.backfillSalesChannels>>;
  const [backfillBusy, setBackfillBusy] = useState<StoreKey | null>(null);
  const [backfillResult, setBackfillResult] = useState<
    Partial<Record<StoreKey, ChannelResult>>
  >({});

  const runBackfill = async (store: StoreKey) => {
    setBackfillBusy(store);
    try {
      const res = await api.backfillSalesChannels(store);
      setBackfillResult((r) => ({ ...r, [store]: res }));
    } catch (e) {
      setBackfillResult((r) => ({
        ...r,
        [store]: {
          store, targets: [], successes: 0, failures_count: 0, failures: [],
          error: e instanceof Error ? e.message : String(e),
        } as ChannelResult,
      }));
    } finally {
      setBackfillBusy(null);
    }
  };

  // ── Catalogue audit (#2) ──
  const [auditBusy, setAuditBusy] = useState<StoreKey | null>(null);
  const [auditResult, setAuditResult] = useState<
    Partial<Record<StoreKey, Awaited<ReturnType<typeof api.auditCatalog>>>>
  >({});

  const runAudit = async (store: StoreKey) => {
    setAuditBusy(store);
    try {
      const res = await api.auditCatalog(store);
      setAuditResult((r) => ({ ...r, [store]: res }));
    } catch (e) {
      setAuditResult((r) => ({
        ...r,
        [store]: {
          store, total: 0,
          missing_cutline: { count: 0, samples: [] },
          no_images: { count: 0, samples: [] },
          not_on_channels: { count: 0, samples: [] },
          duplicates: { count: 0, groups: [] },
          error: e instanceof Error ? e.message : String(e),
        },
      }));
    } finally {
      setAuditBusy(null);
    }
  };

  // ── System health + backups (#7/#8/#9) ──
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null);

  // ── Meta Ads connection test: one paused draft, no import needed ──
  const [metaTestBusy, setMetaTestBusy] = useState(false);
  const [metaTestResult, setMetaTestResult] = useState<string | null>(null);
  const runMetaTest = async () => {
    setMetaTestBusy(true);
    setMetaTestResult(null);
    try {
      const r = await api.metaCreateDraft({
        product_name: "TEST – Meta draft (delete me)",
        items: [{
          store: "fr",
          primary_text: "TEST advertentietekst – verwijder deze campagne na de test.",
          headline: "TEST",
          description: "Gratis verzending",
          colors: [
            {
              product_url: "https://www.vionnaclothing.com",
              image_urls: [
                "https://picsum.photos/seed/vionnaA1/800/800",
                "https://picsum.photos/seed/vionnaA2/800/800",
                "https://picsum.photos/seed/vionnaA3/800/800",
              ],
            },
            {
              product_url: "https://www.vionnaclothing.com",
              image_urls: [
                "https://picsum.photos/seed/vionnaB1/800/800",
                "https://picsum.photos/seed/vionnaB2/800/800",
                "https://picsum.photos/seed/vionnaB3/800/800",
              ],
            },
          ],
        }],
      });
      if (r.error) {
        setMetaTestResult("✕ " + r.error);
      } else {
        const res = (r.results || [])[0];
        setMetaTestResult(
          res?.error
            ? "✕ " + res.error
            : `✓ test campaign ${res?.campaign_id ?? "?"} · ${res?.ad_ids?.length ?? 0} ads created · pixel ${r.pixel_used ?? "none"}`
        );
      }
    } catch (e) {
      setMetaTestResult("✕ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setMetaTestBusy(false);
    }
  };
  const [sysBusy, setSysBusy] = useState<"backup" | "export" | null>(null);
  const [sysMsg, setSysMsg] = useState<string | null>(null);

  const refreshHealth = () => {
    void api.health().then(setHealth).catch(() => setHealth(null));
  };

  const runBackupNow = async () => {
    setSysBusy("backup"); setSysMsg(null);
    try {
      const r = await api.backupNow();
      setSysMsg(r.success ? "✓ Backup snapshot created." : "✕ Backup failed.");
      refreshHealth();
    } catch (e) {
      setSysMsg(`✕ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSysBusy(null);
    }
  };

  const downloadBackup = async () => {
    setSysBusy("export"); setSysMsg(null);
    try {
      const data = await api.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vionna-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setSysMsg("✓ Backup downloaded.");
    } catch (e) {
      setSysMsg(`✕ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSysBusy(null);
    }
  };

  // Re-sync the local draft each time the modal opens (so cancel works)
  useEffect(() => {
    if (open) {
      setDraft({ dk: [...refs.dk], fr: [...refs.fr], fi: [...refs.fi] });
      refreshHealth();
    }
  }, [open, refs]);

  if (!open) return null;

  const examples = draft[activeTab];
  const updateExample = (idx: number, value: string) => {
    const next = [...examples];
    next[idx] = value;
    setDraft({ ...draft, [activeTab]: next });
  };
  const removeExample = (idx: number) => {
    const next = examples.filter((_, i) => i !== idx);
    setDraft({ ...draft, [activeTab]: next });
  };
  const addExample = () => {
    setDraft({ ...draft, [activeTab]: [...examples, ""] });
  };

  const handleFetchFromShopify = async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const r = await api.recentDescriptions({ store: activeTab, limit: 3 });
      if (r.error) throw new Error(r.error);
      const fetched = (r.items ?? []).map((i) => i.description).filter(Boolean);
      if (fetched.length === 0) {
        setFetchError("No active products with descriptions found in this store.");
        return;
      }
      // Replace the active store's examples with the freshly fetched ones
      setDraft({ ...draft, [activeTab]: fetched });
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  };

  const handleSave = () => {
    // Strip empty entries and trim
    const cleaned: ToneReferences = {
      dk: draft.dk.map((s) => s.trim()).filter(Boolean),
      fr: draft.fr.map((s) => s.trim()).filter(Boolean),
      fi: draft.fi.map((s) => s.trim()).filter(Boolean),
    };
    update(cleaned);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-16 px-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-bg-elev border border-border rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-[16px] font-semibold text-text">Settings</h2>
            <p className="text-[11px] text-text-faint mt-0.5">
              Tone reference — example descriptions from your own catalogue, used as a style anchor when Claude writes new content.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-faint hover:text-text text-xl px-2"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5">
          {/* Tabs per store */}
          <div className="inline-flex bg-bg-elev-2 rounded-lg p-[3px] gap-[2px] mb-4">
            {STORE_KEYS.map((s) => {
              const active = s === activeTab;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setActiveTab(s)}
                  className={[
                    "px-3.5 py-1.5 rounded-md text-[12px] font-medium transition-all",
                    active
                      ? "bg-accent text-on-accent shadow-sm"
                      : "text-text-dim hover:text-text",
                  ].join(" ")}
                >
                  {STORE_CONFIG[s].label}
                  <span className="ml-2 text-[10px] opacity-70">
                    ({draft[s].filter(Boolean).length})
                  </span>
                </button>
              );
            })}
          </div>

          <p className="text-[12px] text-text-faint mb-3 leading-relaxed">
            Paste 1-3 product descriptions from your existing {STORE_CONFIG[activeTab].label} catalogue,
            or auto-fetch the 3 most recent active products from Shopify. Claude will mirror their
            length, tone and bullet structure when generating new content. Leave empty to use the
            default house style.
          </p>
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleFetchFromShopify}
              disabled={fetching}
            >
              {fetching ? "Fetching…" : `↓ Fetch 3 recent from ${STORE_CONFIG[activeTab].label}`}
            </Button>
            {fetchError && (
              <span className="text-[11px] text-danger">{fetchError}</span>
            )}
          </div>

          {examples.length === 0 && (
            <div className="text-center py-8 px-4 rounded-[10px] bg-bg-elev-2/50 border border-dashed border-border">
              <p className="text-[13px] text-text-faint mb-3">
                No tone references for {STORE_CONFIG[activeTab].label} yet.
              </p>
              <Button variant="primary" size="sm" onClick={addExample}>
                + Add an example
              </Button>
            </div>
          )}

          {examples.map((ex, i) => (
            <div key={i} className="mb-4 last:mb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-text-dim">
                  Example {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeExample(i)}
                  className="text-[11px] text-text-faint hover:text-danger px-2 py-0.5"
                >
                  Remove
                </button>
              </div>
              <textarea
                value={ex}
                onChange={(e) => updateExample(i, e.target.value)}
                rows={6}
                placeholder="Paste a full product description here…"
                className="w-full bg-bg-elev-2 border border-border rounded-[10px] px-3.5 py-2.5 text-[13px] text-text placeholder:text-text-faint hover:border-border-hover focus:outline-none focus:border-accent focus:ring-3 focus:ring-[var(--accent-soft)] resize-y leading-relaxed"
              />
              <div className="text-[10px] text-text-faint mt-1 text-right">
                {ex.length} chars
              </div>
            </div>
          ))}

          {examples.length > 0 && examples.length < 3 && (
            <Button variant="secondary" size="sm" onClick={addExample}>
              + Add another example
            </Button>
          )}

          {/* ── Sales channels backfill ────────────────────────────── */}
          <div className="mt-8 pt-6 border-t border-border">
            <div className="text-[14px] font-semibold text-text mb-1">
              Sales channels
            </div>
            <p className="text-[12px] text-text-faint mb-3 leading-relaxed">
              Every newly imported product is automatically published to
              Online Store, Facebook and Google. Click the button below to
              also retroactively publish every <em>existing</em> product in
              your catalogue (active or draft) to the same three channels.
              Idempotent — products already on a channel are silently
              re-confirmed.
            </p>
            <div className="flex flex-wrap gap-2">
              {STORE_KEYS.map((s) => {
                const busy = backfillBusy === s;
                const result = backfillResult[s];
                return (
                  <div key={s} className="flex flex-col gap-1 min-w-[200px]">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => runBackfill(s)}
                      disabled={busy || backfillBusy !== null}
                    >
                      {busy
                        ? `⟳ Running on ${STORE_CONFIG[s].label}…`
                        : `↻ Backfill ${STORE_CONFIG[s].label}`}
                    </Button>
                    {result && (
                      <div className="text-[11px] leading-relaxed">
                        {result.error ? (
                          <span className="text-danger">
                            ✕ {result.error}
                            {result.available_publications && result.available_publications.length > 0 && (
                              <span className="block text-text-faint">
                                Available: {result.available_publications.join(", ")}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className={result.successes > 0 ? "text-accent" : "text-warning"}>
                            {result.successes > 0 ? "✓" : "⚠"} {result.successes} of{" "}
                            {result.successes + result.failures_count} products published to{" "}
                            {result.targets.join(", ")}
                            {result.failures_count > 0 && (
                              <span className="block text-warning mt-1">
                                ⚠ {result.failures_count} failed
                                {result.first_failure_error && (
                                  <span className="block text-danger mt-0.5 break-words">
                                    First error: {result.first_failure_error}
                                  </span>
                                )}
                                {result.error_summary && Object.keys(result.error_summary).length > 1 && (
                                  <span className="block text-text-faint mt-0.5">
                                    {Object.keys(result.error_summary).length} distinct error types
                                  </span>
                                )}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Catalogue audit (#2) ──────────────────────────────── */}
          <div className="mt-8 pt-6 border-t border-border">
            <div className="text-[14px] font-semibold text-text mb-1">Catalogue audit</div>
            <p className="text-[12px] text-text-faint mb-3 leading-relaxed">
              Scan a store for products missing a colour swatch (cutline) or image,
              duplicate listings, and active products not on every sales channel.
              Read-only — nothing is changed.
            </p>
            <div className="flex flex-col gap-2.5">
              {STORE_KEYS.map((s) => {
                const busy = auditBusy === s;
                const res = auditResult[s];
                return (
                  <div key={s} className="flex flex-col gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={auditBusy !== null}
                      onClick={() => runAudit(s)}
                    >
                      {busy ? `⟳ Scanning ${STORE_CONFIG[s].label}…` : `🔍 Scan ${STORE_CONFIG[s].label}`}
                    </Button>
                    {res &&
                      (res.error ? (
                        <span className="text-[11px] text-danger">✕ {res.error}</span>
                      ) : (
                        <div className="text-[11px] leading-relaxed pl-1 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span className="text-text-faint">{res.total} products</span>
                          <AuditStat label="missing cutline" n={res.missing_cutline.count} samples={res.missing_cutline.samples} />
                          <AuditStat label="no image" n={res.no_images.count} samples={res.no_images.samples} />
                          <AuditStat label="duplicate" n={res.duplicates.count} samples={res.duplicates.groups.map((g) => g.base)} />
                          <AuditStat label="off-channel" n={res.not_on_channels.count} samples={res.not_on_channels.samples} />
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── System & backups (#7/#8/#9) ───────────────────────── */}
          <div className="mt-8 pt-6 border-t border-border">
            <div className="text-[14px] font-semibold text-text mb-1">System &amp; backups</div>
            {health ? (
              <div className="text-[12px] text-text-dim space-y-2 mb-3">
                <div>
                  Backend <strong>v{health.version}</strong> · Anthropic{" "}
                  <span className={health.anthropic ? "text-accent" : "text-danger"}>
                    {health.anthropic ? "✓" : "✕"}
                  </span>{" "}
                  · Higgsfield CLI{" "}
                  <span className={health.higgsfield_cli ? "text-accent" : "text-warning"}>
                    {health.higgsfield_cli ? "✓" : "✕"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {STORE_KEYS.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-elev-2 border border-border"
                    >
                      <span className="text-text-dim">{STORE_CONFIG[s].label}:</span>
                      {health.stores[s] ? (
                        <>
                          <span className="text-accent">✓ connected</span>
                          <a
                            href={backendAuthUrl(s)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-text-faint underline hover:text-text"
                          >
                            re-auth
                          </a>
                        </>
                      ) : (
                        <a
                          href={backendAuthUrl(s)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-warning underline hover:text-text"
                        >
                          ✕ connect →
                        </a>
                      )}
                    </span>
                  ))}
                </div>
                <div>
                  Backups: <strong>{health.backups.count}</strong> daily snapshot
                  {health.backups.count === 1 ? "" : "s"}
                  {health.backups.last ? ` · latest ${health.backups.last}` : ""}.
                </div>
              </div>
            ) : (
              <div className="text-[12px] text-text-faint mb-3">Loading status…</div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" disabled={sysBusy !== null} onClick={runBackupNow}>
                {sysBusy === "backup" ? "⟳ Backing up…" : "↻ Run backup now"}
              </Button>
              <Button variant="secondary" size="sm" disabled={sysBusy !== null} onClick={downloadBackup}>
                {sysBusy === "export" ? "⟳ Preparing…" : "⬇ Download data backup"}
              </Button>
              {sysMsg && <span className="text-[11px] text-text-faint">{sysMsg}</span>}
            </div>
          </div>

          {/* ── DataForSEO — keyword research ──────────────────────── */}
          <div className="mt-8 pt-6 border-t border-border">
            <div className="text-[14px] font-semibold text-text mb-1">
              DataForSEO — keyword research
              {dfsStatus?.configured && (
                <span className="ml-2 text-[11px] text-accent align-middle">● connected</span>
              )}
            </div>
            <p className="text-[12px] text-text-faint mb-3 leading-relaxed">
              Powers the automatic per-market keyword research at import. Paste your DataForSEO API{" "}
              <strong>login</strong> and <strong>password</strong> (DataForSEO dashboard → API access →
              API credentials). They&apos;re written to your server only, applied immediately, and never
              shown back.
            </p>
            {dfsStatus?.configured && (
              <p className="text-[12px] text-accent mb-3">
                ✓ Connected{dfsStatus.login_hint ? ` (${dfsStatus.login_hint})` : ""}. Enter new values to
                replace.
              </p>
            )}
            <div className="flex flex-col gap-2 max-w-[440px]">
              <input
                type="text"
                value={dfsLogin}
                onChange={(e) => setDfsLogin(e.target.value)}
                placeholder="API login (usually your account email)"
                autoComplete="off"
                spellCheck={false}
                className="w-full px-3 h-10 rounded-[10px] bg-bg-elev-2 border border-border text-[13px] focus:outline-none focus:border-accent focus:ring-3 focus:ring-[var(--accent-soft)]"
              />
              <input
                type="password"
                value={dfsPassword}
                onChange={(e) => setDfsPassword(e.target.value)}
                placeholder="API password"
                autoComplete="new-password"
                className="w-full px-3 h-10 rounded-[10px] bg-bg-elev-2 border border-border text-[13px] focus:outline-none focus:border-accent focus:ring-3 focus:ring-[var(--accent-soft)]"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={dfsBusy || !dfsLogin.trim() || !dfsPassword.trim()}
                  onClick={() => void saveDfs()}
                >
                  {dfsBusy ? "Saving…" : "Save credentials"}
                </Button>
                {dfsMsg && (
                  <span className={`text-[11px] ${dfsMsg.startsWith("✓") ? "text-accent" : "text-danger"}`}>
                    {dfsMsg}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── Meta Ads connection test ───────────────────────────── */}
          <div className="mt-8 pt-6 border-t border-border">
            <div className="text-[14px] font-semibold text-text mb-1">Meta Ads — connection test</div>
            <p className="text-[12px] text-text-faint mb-3 leading-relaxed">
              Creates ONE <strong>paused</strong> test campaign (FR · €30/day · <strong>2 Flexible
              colour ads</strong>) to confirm the full draft pipeline works — without a product
              import or image generation. Delete it in Ads Manager afterwards.
            </p>
            <Button variant="secondary" size="sm" onClick={() => void runMetaTest()} disabled={metaTestBusy}>
              {metaTestBusy ? "Creating…" : "Create paused test draft"}
            </Button>
            {metaTestResult && (
              <p className={`text-[12px] mt-2 ${metaTestResult.startsWith("✓") ? "text-accent" : "text-danger"}`}>
                {metaTestResult}
              </p>
            )}
          </div>

          {/* ── Reset draft (escape hatch) ─────────────────────────── */}
          <div className="mt-6 pt-6 border-t border-border">
            <div className="text-[14px] font-semibold text-text mb-1">
              Reset draft
            </div>
            <p className="text-[12px] text-text-faint mb-3 leading-relaxed">
              Use this if the dashboard is stuck on a broken product state —
              clears the auto-saved draft from both your browser AND the cloud,
              then reloads the page. Won&apos;t affect anything already published to
              Shopify.
            </p>
            <Button variant="secondary" size="sm" onClick={handleResetDraft}>
              ✕ Discard current draft &amp; reload
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-bg-elev-2 rounded-b-2xl">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One audit metric: green "✓ 0 label" when clean, amber "⚠ N label" when not.
 *  Sample handles shown on hover. */
function AuditStat({ label, n, samples }: { label: string; n: number; samples: string[] }) {
  const ok = n === 0;
  return (
    <span
      className={ok ? "text-accent" : "text-warning"}
      title={!ok && samples.length ? `e.g. ${samples.slice(0, 12).join(", ")}` : undefined}
    >
      {ok ? "✓" : "⚠"} {n} {label}
    </span>
  );
}
