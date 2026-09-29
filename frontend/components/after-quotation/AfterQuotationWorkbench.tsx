"use client";

/**
 * After Quotation — correct a fashion listing once the supplier's quote is in.
 *
 * Listings are made before the quote (placeholder XS–XL, the competitor's size
 * chart). When the supplier confirms the real colours, sizes, chart and details,
 * the operator finds the listing here, uploads/pastes what the supplier sent
 * (AI reads it), checks the pre-filled form, previews the exact Shopify changes
 * per store and applies them. Every apply is backed up and can be undone.
 *
 * Backend: server.py "AFTER QUOTATION". The preview is bound to the listing's
 * state (sig) and to this form (fingerprint): change either and Apply is locked
 * until you preview again. Every async answer is tied to the listing that asked
 * for it (activeKey) — a slow AI answer must never land on another listing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  aqApi,
  type AqCopy,
  type AqExtracted,
  type AqFamily,
  type AqFamilySummary,
  type AqJob,
  type AqPlan,
  type AqStoreKey,
  type AqTarget,
  type AqUpload,
} from "@/lib/api";
import {
  AQ_STORES,
  AQ_STORE_LABEL,
  SIZE_PRESETS,
  chartForSizes,
  chartSizes,
  parseChartText,
  parseSizeList,
  sizeKind,
  sizesMatchChart,
  sortSizes,
  targetFingerprint,
  type AqChart,
} from "@/lib/afterQuotation";

type View = "attention" | "recent" | "done";
type Upload = AqUpload & { thumb?: string };
type ColourAction = { action: "keep" | "rename" | "drop"; labels: Partial<Record<AqStoreKey, string>>; notInQuote?: boolean };
type NewColour = { id: string; labels: Record<AqStoreKey, string>; images: Upload[]; activate: boolean; supplier?: string };
type PhotoSet = { mode: "append" | "front"; images: Upload[] };

const MAX_FILE = 15_000_000;
const MAX_APPLY_BYTES = 70_000_000; // the server takes 80 MB; leave room for the rest of the form

// ── files ────────────────────────────────────────────────────────────────────

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(`${file.name}: could not be read`));
    r.readAsDataURL(file);
  });
}

/** Photos are shrunk in the browser: a phone photo is 4-8 MB, the model reads
 *  1800 px just as well and Shopify shows 2400 px at most. The small thumb is
 *  what the page displays — rendering the big one 64 px wide costs ~30 MB each. */
async function shrinkImage(file: File, maxDim: number, quality: number): Promise<{ data: string; thumb: string }> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const draw = (dim: number, q: number) => {
      const scale = Math.min(1, dim / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", q);
    };
    return { data: draw(maxDim, quality), thumb: draw(128, 0.7) };
  } finally {
    bmp.close();
  }
}

const isHeic = (f: File) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);

async function toUpload(file: File, purpose: "read" | "photo"): Promise<Upload> {
  if (purpose === "photo" && isHeic(file)) throw new Error(`${file.name}: iPhone HEIC photo — export it as JPG first`);
  if (purpose === "photo" && !file.type.startsWith("image/")) throw new Error(`${file.name}: not a photo`);
  if (file.type.startsWith("image/") && !isHeic(file)) {
    try {
      const r = await shrinkImage(file, purpose === "read" ? 1800 : 2400, purpose === "read" ? 0.85 : 0.9);
      return { name: file.name, data: r.data, thumb: r.thumb };
    } catch {
      if (purpose === "photo") throw new Error(`${file.name}: could not be read as a photo`);
    }
  }
  if (file.size > MAX_FILE) throw new Error(`${file.name} is larger than 15 MB`);
  return { name: file.name, data: await readAsDataUrl(file) };
}

/** One file at a time (ten phone photos decoded at once can run a tab out of
 *  memory); a file that fails is reported, the others still come through. */
async function toUploads(files: File[], purpose: "read" | "photo", cap: number): Promise<{ ok: Upload[]; errors: string[] }> {
  const ok: Upload[] = [];
  const errors: string[] = [];
  for (const f of files.slice(0, cap)) {
    try {
      ok.push(await toUpload(f, purpose));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (files.length > cap) errors.push(`only the first ${cap} files were taken`);
  return { ok, errors };
}

const thumb = (url: string, w = 160) => (url ? `${url}${url.includes("?") ? "&" : "?"}width=${w}` : "");
const textOf = (html: string) =>
  html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h\d|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");
const newId = () => Math.random().toString(36).slice(2, 9);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── small UI pieces ──────────────────────────────────────────────────────────

function Card({ n, title, hint, children, right }: { n?: string; title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="bg-bg-elev border border-border rounded-2xl p-5 lg:p-6">
      <div className="flex items-start gap-3 mb-4">
        {n && (
          <div className="shrink-0 w-7 h-7 rounded-full bg-[var(--accent-soft)] text-accent text-[13px] font-bold flex items-center justify-center">
            {n}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-semibold text-text">{title}</h2>
          {hint && <p className="text-[12px] text-text-dim mt-0.5 leading-relaxed">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Pill({ on, onClick, children, title, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`px-2.5 h-7 rounded-[9px] text-[12px] border transition whitespace-nowrap disabled:opacity-50 ${
        on ? "border-accent text-accent bg-[var(--accent-soft)]" : "border-border text-text-dim hover:border-border-hover"
      }`}
    >
      {children}
    </button>
  );
}

function Banner({ tone, children }: { tone: "danger" | "warning" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "danger"
      ? "border-danger/40 bg-danger/10 text-danger"
      : tone === "warning"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-border bg-bg-elev-2 text-text-dim";
  return <div className={`rounded-lg border px-3 py-2 text-[12px] leading-relaxed ${cls}`}>{children}</div>;
}

function DropZone({
  label,
  accept,
  onFiles,
  busy,
}: {
  label: string;
  accept: string;
  onFiles: (files: File[]) => void;
  busy?: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length && !busy) onFiles(files);
      }}
      className={`flex items-center justify-center text-center gap-2 px-4 py-4 rounded-xl border border-dashed cursor-pointer transition text-[12px] ${
        over ? "border-accent bg-[var(--accent-soft)] text-accent" : "border-border bg-bg-elev-2/50 text-text-dim hover:border-accent"
      }`}
    >
      <input
        type="file"
        accept={accept}
        multiple
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      {busy ? "Preparing files…" : label}
    </label>
  );
}

function Thumbs({ items, onRemove }: { items: Upload[]; onRemove: (i: number) => void }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map((f, i) => (
        <div key={i} className="relative group">
          {f.thumb || f.data.startsWith("data:image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={f.thumb ?? f.data} alt={f.name} className="w-16 h-16 object-cover rounded-lg border border-border" />
          ) : (
            <div className="w-16 h-16 rounded-lg border border-border bg-bg-elev-2 text-[10px] text-text-dim p-1 break-all overflow-hidden">
              {f.name}
            </div>
          )}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-bg border border-border text-[11px] text-text-dim hover:text-danger"
            aria-label={`Remove ${f.name}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

const inputCls =
  "w-full px-3 h-9 rounded-[10px] bg-bg-elev-2 border border-border text-[12.5px] text-text focus:outline-none focus:border-accent";

// ── the page ─────────────────────────────────────────────────────────────────

export function AfterQuotationWorkbench() {
  // search
  const [view, setView] = useState<View>("attention");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AqFamilySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [storeErrors, setStoreErrors] = useState<Partial<Record<AqStoreKey, string>>>({});
  const searchSeq = useRef(0);
  const qRef = useRef(q);
  const viewRef = useRef(view);
  qRef.current = q;
  viewRef.current = view;

  // the listing
  const [family, setFamily] = useState<AqFamily | null>(null);
  const [familyLoading, setFamilyLoading] = useState(false);
  const [familyErr, setFamilyErr] = useState<string | null>(null);
  const activeKey = useRef<string | null>(null);
  const familySeq = useRef(0);
  const stillOn = (key: string) => activeKey.current === key;

  // supplier material
  const [files, setFiles] = useState<Upload[]>([]);
  const [filesBusy, setFilesBusy] = useState(false);
  const [pasted, setPasted] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<AqExtracted | null>(null);
  const [extractInfo, setExtractInfo] = useState<{ used: string[]; skipped: string[] } | null>(null);
  const [extractErr, setExtractErr] = useState<string | null>(null);

  // what's true now
  const [stores, setStores] = useState<AqStoreKey[]>([]);
  const [sizesMode, setSizesMode] = useState<"keep" | "set">("keep");
  const [sizeList, setSizeList] = useState<string[]>([]);
  const [sizeInput, setSizeInput] = useState("");
  const [chartMode, setChartMode] = useState<"keep" | "set">("keep");
  const [chart, setChart] = useState<AqChart>({ headers: [], rows: [] });
  const [chartPaste, setChartPaste] = useState("");
  const [colourActions, setColourActions] = useState<Record<string, ColourAction>>({});
  const [newColours, setNewColours] = useState<NewColour[]>([]);
  const [photos, setPhotos] = useState<Record<string, PhotoSet>>({});
  const [photoBusy, setPhotoBusy] = useState(0);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [material, setMaterial] = useState("");
  const [factsText, setFactsText] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [copy, setCopy] = useState<Partial<Record<AqStoreKey, AqCopy>>>({});
  const [copyUse, setCopyUse] = useState<Partial<Record<AqStoreKey, boolean>>>({});
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyErr, setCopyErr] = useState<string | null>(null);

  // preview + apply
  const [plan, setPlan] = useState<AqPlan | null>(null);
  const [planFingerprint, setPlanFingerprint] = useState("");
  const [planning, setPlanning] = useState(false);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [job, setJob] = useState<AqJob | null>(null);
  const [jobErr, setJobErr] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const jobRunning = applying || job?.status === "running";

  // ── search ──
  const runSearch = useCallback(async (query: string, v: View, refresh = false) => {
    const seq = ++searchSeq.current;
    setSearching(true);
    setSearchErr(null);
    try {
      const r = await aqApi.search(query, v, refresh);
      if (seq !== searchSeq.current) return;
      setResults(r.families);
      setTotal(r.total);
      setStoreErrors(r.store_errors || {});
    } catch (e) {
      if (seq === searchSeq.current) setSearchErr(errText(e));
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void runSearch(q, view), q ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [q, view, runSearch]);

  // ── one listing ──
  const resetForm = useCallback((f: AqFamily) => {
    const present = AQ_STORES.filter((s) => f.stores[s]);
    const firstSizes = f.rows.map((r) => Object.values(r.cells)[0]?.sizes).find((x) => x && x.length) ?? [];
    const firstChart = present.map((s) => f.stores[s]?.chart).find(Boolean) ?? null;
    setStores(present);
    setSizesMode("keep");
    setSizeList(firstSizes);
    setSizeInput("");
    setChartMode("keep");
    setChart(firstChart ? { headers: [...firstChart.headers], rows: firstChart.rows.map((r) => [...r]) } : chartForSizes(firstSizes));
    setChartPaste("");
    setColourActions({});
    setNewColours([]);
    setPhotos({});
    setPhotoErr(null);
    setMaterial("");
    setFactsText("");
    setModelsText("");
    setCopy({});
    setCopyUse({});
    setCopyErr(null);
    setPlan(null);
    setPlanFingerprint("");
    setPlanErr(null);
  }, []);

  const loadFamily = useCallback(
    async (key: string, opts?: { keepForm?: boolean; refresh?: boolean }) => {
      const seq = ++familySeq.current;
      activeKey.current = key; // from now on, answers for any other listing are dropped
      setFamilyLoading(true);
      setFamilyErr(null);
      try {
        const f = await aqApi.family(key, opts?.refresh);
        if (seq !== familySeq.current) return;
        setFamily(f);
        if (!opts?.keepForm) {
          resetForm(f);
          setFiles([]);
          setPasted("");
          setExtracted(null);
          setExtractInfo(null);
          setExtractErr(null);
          setJob(null);
          setJobErr(null);
        }
        const url = new URL(window.location.href);
        url.searchParams.set("key", key);
        window.history.replaceState(null, "", url.toString());
      } catch (e) {
        if (seq === familySeq.current) setFamilyErr(errText(e));
      } finally {
        if (seq === familySeq.current) setFamilyLoading(false);
      }
    },
    [resetForm]
  );

  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("key");
    if (key) void loadFamily(key);
  }, [loadFamily]);

  const presentStores = useMemo(() => (family ? AQ_STORES.filter((s) => family.stores[s]) : []), [family]);
  const currentSizes = useMemo(
    () => family?.rows.map((r) => Object.values(r.cells)[0]?.sizes).find((x) => x && x.length) ?? [],
    [family]
  );
  const sizes = sizesMode === "set" ? sizeList : currentSizes;
  const activeChart = chartMode === "set" ? chart : (family && presentStores.map((s) => family.stores[s]?.chart).find(Boolean)) || null;
  const chartCheck = sizesMatchChart(sizes, activeChart);

  const dirty =
    files.length > 0 ||
    pasted.trim() !== "" ||
    sizesMode === "set" ||
    chartMode === "set" ||
    Object.values(colourActions).some((a) => a.action !== "keep") ||
    newColours.length > 0 ||
    Object.values(photos).some((p) => p.images.length > 0) ||
    Object.keys(copy).length > 0 ||
    !!material.trim() ||
    !!factsText.trim() ||
    !!modelsText.trim();

  useEffect(() => {
    if (!dirty && !jobRunning) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty, jobRunning]);

  const openFamily = (key: string) => {
    if (jobRunning) return; // the list is locked while Shopify is being written
    if (family && key !== family.key && dirty && !window.confirm("Leave this listing? What you filled in has not been applied.")) return;
    void loadFamily(key);
  };

  // ── supplier material → form ──
  const addFiles = async (list: File[]) => {
    setFilesBusy(true);
    setExtractErr(null);
    const { ok, errors } = await toUploads(list, "read", Math.max(0, 12 - files.length));
    setFiles((prev) => [...prev, ...ok].slice(0, 12));
    if (errors.length) setExtractErr(errors.join(" · "));
    setFilesBusy(false);
  };

  const applyExtraction = (x: AqExtracted, f: AqFamily) => {
    if (x.sizes.length) {
      setSizesMode("set");
      setSizeList(x.sizes); // as the server normalised them — "S/M" stays one size
    }
    if (x.size_chart && x.size_chart.rows.length) {
      setChartMode("set");
      setChart({ headers: [...x.size_chart.headers], rows: x.size_chart.rows.map((r) => [...r]) });
    }
    if (x.colours.length) {
      // Colours the supplier didn't list are MARKED, never pre-hidden: a colour
      // visible only in a photo, or a mis-match, must not take a live colour
      // (and its ads) down with one click on Apply.
      const matched = new Set(x.colours.map((c) => c.row_id).filter(Boolean) as string[]);
      const acts: Record<string, ColourAction> = {};
      for (const r of f.rows) if (!matched.has(r.row_id)) acts[r.row_id] = { action: "keep", labels: {}, notInQuote: true };
      setColourActions(acts);
      setNewColours((prev) => {
        const kept = prev.filter((c) => c.images.length > 0);
        const have = new Set(kept.map((c) => (c.labels.dk || c.supplier || "").toLowerCase()));
        const fresh = x.colours
          .filter((c) => !c.row_id && !have.has((c.labels.dk || c.supplier_name || "").toLowerCase()))
          .map((c) => ({
            id: newId(),
            labels: { dk: c.labels.dk || "", fr: c.labels.fr || "", fi: c.labels.fi || "" },
            images: [] as Upload[],
            activate: false,
            supplier: c.supplier_name,
          }));
        return [...kept, ...fresh];
      });
    }
    if (x.material) setMaterial(x.material);
    if (x.facts.length) setFactsText(x.facts.join("\n"));
    if (x.models.length) setModelsText(x.models.map((m) => `${m.name} — ${m.details}`).join("\n"));
  };

  const runExtract = async () => {
    if (!family) return;
    const key = family.key;
    const f = family;
    setExtracting(true);
    setExtractErr(null);
    try {
      const r = await aqApi.extract({
        files: files.map(({ name, data }) => ({ name, data })),
        text: pasted,
        context: {
          name: f.name,
          cat: f.cat,
          sizes: currentSizes,
          rows: f.rows.map((row) => ({
            row_id: row.row_id,
            labels: Object.fromEntries(Object.entries(row.cells).map(([s, c]) => [s, c?.colour ?? ""])),
          })),
        },
      });
      if (!stillOn(key)) return;
      setExtracted(r.extracted);
      setExtractInfo({ used: r.files_used, skipped: r.files_skipped });
      const manual =
        sizesMode === "set" ||
        chartMode === "set" ||
        Object.values(colourActions).some((a) => a.action !== "keep") ||
        newColours.length > 0 ||
        !!material.trim() ||
        !!factsText.trim();
      if (!manual || window.confirm("Fill in the steps below with this reading? What you already typed there is replaced (new colours with photos stay).")) {
        applyExtraction(r.extracted, f);
      }
    } catch (e) {
      if (stillOn(key)) setExtractErr(errText(e));
    } finally {
      if (stillOn(key)) setExtracting(false);
    }
  };

  const addPhotos = async (list: File[], put: (ups: Upload[]) => void) => {
    setPhotoBusy((n) => n + 1);
    setPhotoErr(null);
    try {
      const { ok, errors } = await toUploads(list, "photo", 10);
      put(ok);
      if (errors.length) setPhotoErr(errors.join(" · "));
    } finally {
      setPhotoBusy((n) => n - 1);
    }
  };

  // ── target ──
  const buildTarget = useCallback(
    (withImages: boolean): AqTarget => {
      const note = extracted
        ? [
            extracted.material && `material: ${extracted.material}`,
            extracted.colours.length && `colours: ${extracted.colours.map((c) => c.supplier_name).join(", ")}`,
            extracted.price && `price: ${extracted.price.amount} ${extracted.price.currency}`,
          ]
            .filter(Boolean)
            .join(" · ")
        : "";
      return {
        stores,
        sizes: sizesMode === "set" ? sizeList : null,
        size_chart: chartMode === "set" ? chart : null,
        colours: Object.entries(colourActions)
          .filter(([, a]) => a.action !== "keep")
          .map(([row_id, a]) => ({ row_id, action: a.action, labels: a.action === "rename" ? a.labels : undefined })),
        new_colours: newColours.map((c) => ({
          labels: c.labels,
          activate: c.activate,
          images: withImages ? c.images.map((i) => i.data) : c.images.length,
        })),
        photos: Object.entries(photos)
          .filter(([, p]) => p.images.length)
          .map(([row_id, p]) => ({ row_id, mode: p.mode, images: withImages ? p.images.map((i) => i.data) : p.images.length })),
        descriptions: Object.fromEntries(
          Object.entries(copy)
            .filter(([s, c]) => copyUse[s as AqStoreKey] && c && c.after.trim())
            .map(([s, c]) => [s, (c as AqCopy).after])
        ),
        supplier_note: note || undefined,
      };
    },
    [stores, sizesMode, sizeList, chartMode, chart, colourActions, newColours, photos, copy, copyUse, extracted]
  );

  // with images: a swapped photo must make the preview stale (the fingerprint
  // shortens each photo to its size + last bytes, never copies it)
  const currentFingerprint = useMemo(() => targetFingerprint(buildTarget(true)), [buildTarget]);
  const planIsFresh = !!plan && planFingerprint === currentFingerprint;
  const uploadBytes = useMemo(
    () =>
      newColours.reduce((n, c) => n + c.images.reduce((m, i) => m + i.data.length, 0), 0) +
      Object.values(photos).reduce((n, p) => n + p.images.reduce((m, i) => m + i.data.length, 0), 0),
    [newColours, photos]
  );

  const runPlan = async () => {
    if (!family) return;
    const key = family.key;
    setPlanning(true);
    setPlanErr(null);
    try {
      const fp = targetFingerprint(buildTarget(true));
      const p = await aqApi.plan(key, buildTarget(false));
      if (!stillOn(key)) return;
      setPlan(p);
      setPlanFingerprint(fp);
    } catch (e) {
      if (stillOn(key)) {
        setPlanErr(errText(e));
        setPlan(null);
      }
    } finally {
      if (stillOn(key)) setPlanning(false);
    }
  };

  const pollJob = async (id: string, key: string): Promise<AqJob | null> => {
    let misses = 0;
    for (let i = 0; i < 900; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const j = await aqApi.job(id).catch(() => null);
      if (!j) {
        if (++misses >= 5) {
          if (stillOn(key)) setJobErr("Lost contact with the job (server restarted?) — reload the listing to see what landed.");
          return null;
        }
        continue;
      }
      misses = 0;
      if (stillOn(key)) setJob(j);
      if (j.status !== "running") return j;
    }
    return null;
  };

  const runApply = async () => {
    if (!family || !plan || !planIsFresh || jobRunning || photoBusy) return;
    const key = family.key;
    if (uploadBytes > MAX_APPLY_BYTES) {
      setJobErr(
        `That is ${Math.round(uploadBytes / 1e6)} MB of photos in one go — too much for one upload. Apply some colours now and the rest in a second round.`
      );
      return;
    }
    const opStores = AQ_STORES.filter((s) => plan.ops.some((o) => o.store === s));
    const hides = plan.ops.filter((o) => o.op === "draft").map((o) => `${o.store.toUpperCase()} ${o.text.split(":")[0]}`);
    const n = plan.ops.length;
    if (
      !window.confirm(
        `Write ${n} change${n === 1 ? "" : "s"} to ${opStores.map((s) => AQ_STORE_LABEL[s]).join(", ")} now?` +
          (hides.length ? `\n\nThese colours will be HIDDEN (set to draft): ${hides.join(", ")}` : "") +
          `\n\nEverything is backed up first and can be undone from this page.`
      )
    )
      return;
    if (
      plan.warnings.some((w) => w.includes("every colour would be hidden")) &&
      !window.confirm("In at least one store EVERY colour of this product will be hidden — it disappears from that shop. Continue?")
    )
      return;
    setApplying(true);
    setJobErr(null);
    setJob(null);
    try {
      const { job_id } = await aqApi.apply(family.key, buildTarget(true), plan.sig);
      const done = await pollJob(job_id, key);
      if (done && (done.status === "done" || done.status === "partial") && stillOn(key)) {
        // Photos and new colours are one-shot: they landed (or the log says
        // which didn't). Kept in the form, a second Apply would upload them
        // again. Sizes, chart, renames and descriptions stay — re-applying
        // those is a no-op. On 'error' nothing was written: keep everything.
        setPhotos({});
        setNewColours([]);
        setPlan(null);
        setPlanFingerprint("");
        await loadFamily(key, { keepForm: true });
      }
      void runSearch(qRef.current, viewRef.current);
    } catch (e) {
      if (stillOn(key)) setJobErr(errText(e));
    } finally {
      setApplying(false);
    }
  };

  const runUndo = async (backupId: string) => {
    if (!family || jobRunning) return;
    const key = family.key;
    if (!window.confirm("Undo this change? What it wrote goes back to how it was — fields someone changed since are left alone.")) return;
    setApplying(true);
    setJobErr(null);
    setJob(null);
    try {
      const { job_id } = await aqApi.undo(backupId);
      const done = await pollJob(job_id, key);
      if (done && stillOn(key)) await loadFamily(key, { keepForm: false });
      void runSearch(qRef.current, viewRef.current);
    } catch (e) {
      if (stillOn(key)) setJobErr(errText(e));
    } finally {
      setApplying(false);
    }
  };

  const runCopy = async () => {
    if (!family) return;
    const key = family.key;
    setCopyBusy(true);
    setCopyErr(null);
    try {
      const r = await aqApi.copy({
        key,
        stores,
        material,
        facts: factsText.split("\n").map((s) => s.trim()).filter(Boolean),
        models: modelsText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const [name, ...rest] = l.split(/\s+[—-]\s+/);
            return { name, details: rest.join(" — ") };
          }),
      });
      if (!stillOn(key)) return;
      setCopy(r.copy);
      // ticked only when it changed AND nothing was flagged (a colour word in
      // shared copy, formatting that wasn't there, a big length change)
      setCopyUse(Object.fromEntries(Object.entries(r.copy).map(([s, c]) => [s, !!c && c.after !== c.before && !c.warnings.length])));
      const errs = Object.entries(r.errors || {});
      if (errs.length) setCopyErr(errs.map(([s, m]) => `${AQ_STORE_LABEL[s as AqStoreKey]}: ${m}`).join(" · "));
    } catch (e) {
      if (stillOn(key)) setCopyErr(errText(e));
    } finally {
      if (stillOn(key)) setCopyBusy(false);
    }
  };

  const addSizes = () => {
    const add = parseSizeList(sizeInput);
    if (!add.length) return;
    setSizeList((prev) => sortSizes([...prev, ...add]));
    setSizeInput("");
  };

  const newestUndoable = family?.history.find((h) => !h.undone && h.status !== "error" && h.status !== "running");
  const notInQuote = family ? family.rows.filter((r) => colourActions[r.row_id]?.notInQuote).length : 0;

  // ── render ──
  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-40 bg-bg/90 backdrop-blur border-b border-border">
        <div className="max-w-[1400px] mx-auto px-5 lg:px-8 h-14 flex items-center gap-4">
          <span className="text-[15px] font-semibold text-text">🧾 After quotation</span>
          <span className="hidden md:inline text-[12px] text-text-faint">
            Supplier confirmed the real product? Put it on the listing.
          </span>
          <span className="flex-1" />
          <a href="/" className="text-[12px] text-accent hover:underline whitespace-nowrap">
            ← Dashboard
          </a>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-5 lg:px-8 py-6 grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] gap-6">
        {/* ── search ── */}
        <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto pr-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, colour, Shopify link or competitor URL…"
            className={inputCls}
            aria-label="Search listings"
          />
          <div className="flex items-center gap-1.5 flex-wrap">
            <Pill on={view === "attention"} onClick={() => setView("attention")} title="Listed in the last 60 days and not done yet, or a clear contradiction (shoes in XS–XL, sizes ≠ chart, no chart)">
              Needs attention
            </Pill>
            <Pill on={view === "recent"} onClick={() => setView("recent")}>
              Newest
            </Pill>
            <Pill on={view === "done"} onClick={() => setView("done")}>
              Done
            </Pill>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => void runSearch(q, view, true)}
              className="text-[11.5px] text-text-dim hover:text-accent"
              title="Re-read every listing from Shopify (takes ~15 s)"
            >
              ↻ Refresh
            </button>
          </div>
          <p className="text-[11.5px] text-text-faint">
            {searching ? "Searching…" : `${total} listing${total === 1 ? "" : "s"}${q ? " found" : view === "attention" ? " need attention" : ""}`}
          </p>
          {jobRunning && <Banner tone="info">Writing to Shopify — the list is locked until it&apos;s done.</Banner>}
          {searchErr && <Banner tone="danger">{searchErr}</Banner>}
          {Object.entries(storeErrors).map(([s, m]) => (
            <Banner key={s} tone="warning">
              {AQ_STORE_LABEL[s as AqStoreKey]} could not be read: {m}
            </Banner>
          ))}
          <ul className="space-y-2">
            {results.map((f) => {
              const on = family?.key === f.key;
              return (
                <li key={f.key}>
                  <button
                    type="button"
                    onClick={() => openFamily(f.key)}
                    disabled={jobRunning && !on}
                    className={`w-full text-left flex gap-3 p-2.5 rounded-xl border transition disabled:opacity-50 ${
                      on ? "border-accent bg-[var(--accent-soft)]" : "border-border bg-bg-elev hover:border-border-hover"
                    }`}
                  >
                    {f.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb(f.image, 120)} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 bg-bg-elev-2" />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-bg-elev-2 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[13px] font-semibold text-text truncate">{f.name}</span>
                        <span className="text-[11px] text-text-faint">{f.cat}</span>
                        <span className="flex-1" />
                        <span className="text-[10.5px] text-text-faint whitespace-nowrap">{fmtDate(f.created)}</span>
                      </div>
                      <div className="text-[11px] text-text-dim mt-0.5">
                        {f.colours.length} colour{f.colours.length === 1 ? "" : "s"} ·{" "}
                        {AQ_STORES.filter((s) => f.stores[s]).map((s) => AQ_STORE_LABEL[s]).join(" ")} · {f.sizes.join(" ")}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {f.processed && <span className="text-[10.5px] px-1.5 rounded bg-green-500/15 text-green-600 dark:text-green-400">✓ done {fmtDate(f.processed)}</span>}
                        {f.flags.map((fl) => (
                          <span
                            key={fl.code}
                            title={fl.text}
                            className={`text-[10.5px] px-1.5 rounded ${fl.hard ? "bg-warning/15 text-warning" : "bg-bg-elev-2 text-text-faint"}`}
                          >
                            {fl.text}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* ── the listing ── */}
        <main className="space-y-5 min-w-0">
          {!family && !familyLoading && !familyErr && (
            <Card title="Pick a listing" hint="Search on the left — by product name, colour, a Shopify admin or shop link, or the competitor page it was copied from.">
              <ol className="text-[12.5px] text-text-dim space-y-1.5 list-decimal pl-5">
                <li>Upload what the supplier sent (screenshots, size chart, Excel/PDF) or paste the chat — AI fills in the form.</li>
                <li>Check sizes, size chart, colours, photos and the description facts.</li>
                <li>Preview exactly what changes in DK / FR / FI, then apply. Every change is backed up and can be undone.</li>
              </ol>
            </Card>
          )}
          {familyLoading && <p className="text-[12.5px] text-text-faint">Reading the listing from Shopify…</p>}
          {familyErr && <Banner tone="danger">{familyErr}</Banner>}

          {family && (
            <>
              {/* header + current state */}
              <Card
                title={`${family.name}`}
                hint={`${family.type || family.cat || "product"} · ${family.rows.length} colour${family.rows.length === 1 ? "" : "s"} · ${presentStores
                  .map((s) => `${AQ_STORE_LABEL[s]} ${family.stores[s]?.count ?? 0}`)
                  .join(" · ")}`}
                right={
                  <Button variant="ghost" size="sm" onClick={() => void loadFamily(family.key, { keepForm: true, refresh: true })} disabled={familyLoading || jobRunning}>
                    ↻ Reload
                  </Button>
                }
              >
                {family.flags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {family.flags.map((fl) => (
                      <span key={fl.code} className={`text-[11px] px-2 py-0.5 rounded-md ${fl.hard ? "bg-warning/15 text-warning" : "bg-bg-elev-2 text-text-dim"}`}>
                        {fl.text}
                      </span>
                    ))}
                  </div>
                )}
                {Object.entries(family.store_errors).map(([s, m]) => (
                  <Banner key={s} tone="warning">
                    {AQ_STORE_LABEL[s as AqStoreKey]} could not be read ({m}) — changes can only be made to the stores that loaded.
                  </Banner>
                ))}
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px] border-collapse">
                    <thead>
                      <tr className="text-text-faint text-left">
                        <th className="font-medium py-1.5 pr-3 w-16"></th>
                        {presentStores.map((s) => (
                          <th key={s} className="font-medium py-1.5 pr-3">
                            {AQ_STORE_LABEL[s]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {family.rows.map((r) => {
                        const img = Object.values(r.cells).find((c) => c?.images?.length)?.images[0];
                        return (
                          <tr key={r.row_id} className="border-t border-border align-top">
                            <td className="py-2 pr-3">
                              {img ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={thumb(img, 96)} alt="" className="w-11 h-11 rounded-md object-cover bg-bg-elev-2" />
                              ) : (
                                <div className="w-11 h-11 rounded-md bg-bg-elev-2" />
                              )}
                            </td>
                            {presentStores.map((s) => {
                              const c = r.cells[s];
                              if (!c) return <td key={s} className="py-2 pr-3 text-text-faint">— not in this store</td>;
                              return (
                                <td key={s} className="py-2 pr-3">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`w-1.5 h-1.5 rounded-full ${c.status === "active" ? "bg-green-500" : "bg-text-faint"}`} title={c.status} />
                                    <a href={c.admin_url} target="_blank" rel="noreferrer" className="font-medium text-text hover:text-accent">
                                      {c.colour || "(no colour)"}
                                    </a>
                                    {c.match === "order" && (
                                      <span className="text-[10.5px] text-text-faint" title="Lined up by listing order — the colour words don't translate one-to-one. Check it's the same colour.">
                                        ≈
                                      </span>
                                    )}
                                    {c.status !== "active" && <span className="text-[10.5px] text-text-faint">{c.status}</span>}
                                  </div>
                                  <div className="text-text-dim mt-0.5">{c.sizes.join(" ")}</div>
                                  <div className="text-text-faint text-[11px]">
                                    {c.image_count} photo{c.image_count === 1 ? "" : "s"} · {c.has_chart ? "chart ✓" : "no chart"}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* 1. supplier material */}
              <Card
                n="1"
                title="What the supplier sent"
                hint="Drop screenshots of the chat, the size chart, a spec sheet, an Excel or PDF quote — or paste the text. AI reads it and fills in the steps below; you check everything before anything is written."
              >
                <DropZone
                  label="Drop files here or click — photos, screenshots, PDF, Excel (.xlsx), CSV"
                  accept="image/*,application/pdf,.pdf,.xlsx,.csv,.txt"
                  onFiles={(fs) => void addFiles(fs)}
                  busy={filesBusy}
                />
                <Thumbs items={files} onRemove={(i) => setFiles((p) => p.filter((_, j) => j !== i))} />
                <textarea
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  rows={4}
                  placeholder="…or paste the supplier's message here (colours, sizes, measurements, material)"
                  className="w-full mt-3 px-3 py-2 rounded-[10px] bg-bg-elev-2 border border-border text-[12.5px] text-text focus:outline-none focus:border-accent"
                />
                <div className="flex items-center gap-3 mt-3 flex-wrap">
                  <Button size="sm" onClick={() => void runExtract()} disabled={extracting || filesBusy || (!files.length && !pasted.trim())}>
                    {extracting ? "Reading…" : "✨ Read with AI"}
                  </Button>
                  <span className="text-[11.5px] text-text-faint">Takes 10–40 seconds. You can also skip this and fill in the steps yourself.</span>
                </div>
                {extractErr && <div className="mt-3"><Banner tone="danger">{extractErr}</Banner></div>}
                {extracted && (
                  <div className="mt-3 space-y-2">
                    <Banner tone={extracted.confidence === "low" ? "warning" : "info"}>
                      <strong>Read with {extracted.confidence} confidence</strong>
                      {extractInfo?.used.length ? ` from ${extractInfo.used.join(", ")}` : ""}.{" "}
                      {[
                        extracted.colours.length && `${extracted.colours.length} colour(s)`,
                        extracted.sizes.length && `sizes ${extracted.sizes.join(" ")}`,
                        extracted.size_chart && "a size chart",
                        extracted.material && `material: ${extracted.material}`,
                        extracted.price && `price ${extracted.price.amount} ${extracted.price.currency}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      . Check the steps below.
                    </Banner>
                    {[...(extracted.notes || []), ...(extractInfo?.skipped || [])].map((n, i) => (
                      <Banner key={i} tone="warning">
                        {n}
                      </Banner>
                    ))}
                  </div>
                )}
              </Card>

              {/* 2. sizes */}
              <Card
                n="2"
                title="Sizes"
                hint="Written to every colour in the chosen stores. A size that stays keeps its Shopify variant (orders and margin tracking stay attached); new sizes copy the price."
                right={
                  <div className="flex gap-1.5">
                    <Pill on={sizesMode === "keep"} onClick={() => setSizesMode("keep")}>Keep</Pill>
                    <Pill
                      on={sizesMode === "set"}
                      onClick={() => {
                        if (sizesMode !== "set" && !sizeList.length) setSizeList(currentSizes);
                        setSizesMode("set");
                      }}
                    >
                      Change
                    </Pill>
                  </div>
                }
              >
                {sizesMode === "keep" ? (
                  <p className="text-[12.5px] text-text-dim">Now: {currentSizes.join(" ") || "—"}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {sizeList.map((s) => (
                        <span key={s} className="inline-flex items-center gap-1 pl-2.5 pr-1 h-7 rounded-[9px] border border-accent/50 bg-[var(--accent-soft)] text-[12px] text-text">
                          {s}
                          <button
                            type="button"
                            onClick={() => setSizeList((p) => p.filter((x) => x !== s))}
                            className="w-5 h-5 rounded text-text-faint hover:text-danger"
                            aria-label={`Remove size ${s}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {!sizeList.length && <span className="text-[12px] text-text-faint">No sizes yet</span>}
                      {sizeList.length > 0 && (
                        <button type="button" onClick={() => setSizeList([])} className="text-[11.5px] text-text-faint hover:text-danger ml-1">
                          clear
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <input
                        value={sizeInput}
                        onChange={(e) => setSizeInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addSizes();
                        }}
                        className={inputCls}
                        placeholder="Add sizes: S-2XL, 35-41, S M L, 36,5 …"
                        aria-label="Add sizes"
                      />
                      <Button variant="secondary" size="sm" className="h-9" onClick={addSizes} disabled={!parseSizeList(sizeInput).length}>
                        Add
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="text-[11px] text-text-faint self-center">Replace with:</span>
                      {SIZE_PRESETS.map((p) => (
                        <Pill key={p.label} on={false} onClick={() => setSizeList(parseSizeList(p.text))}>
                          {p.label}
                        </Pill>
                      ))}
                    </div>
                    <p className="text-[12px] text-text mt-2">
                      Will be: <strong>{sizeList.join(" ") || "—"}</strong>
                      <span className="text-text-faint"> (was {currentSizes.join(" ")})</span>
                    </p>
                  </>
                )}
                {family.cat === "shoes" && sizeKind(sizes) === "letter" && (
                  <div className="mt-2"><Banner tone="warning">Shoes in clothing sizes — shoes are sold in EU sizes (35, 36, …).</Banner></div>
                )}
                {chartCheck === false && (
                  <div className="mt-2">
                    <Banner tone="warning">
                      The size chart has rows {chartSizes(activeChart).join(" ")}, the sizes are {sizes.join(" ")}. Make them match.
                    </Banner>
                  </div>
                )}
              </Card>

              {/* 3. size chart */}
              <Card
                n="3"
                title="Size chart"
                hint="In cm (inches are converted). The headers are translated for each store automatically."
                right={
                  <div className="flex gap-1.5">
                    <Pill on={chartMode === "keep"} onClick={() => setChartMode("keep")}>Keep</Pill>
                    <Pill on={chartMode === "set"} onClick={() => setChartMode("set")}>Change</Pill>
                  </div>
                }
              >
                {chartMode === "keep" ? (
                  activeChart ? <ChartView chart={activeChart} /> : <p className="text-[12.5px] text-text-dim">No size chart on this listing.</p>
                ) : (
                  <>
                    <ChartEditor chart={chart} onChange={setChart} />
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setChart(chartForSizes(sizes, chart.headers.length ? chart.headers : undefined, chart))}
                        title="Adds a row for each size that has none and removes rows for sizes you don't sell; measurements you typed stay"
                      >
                        Rows = sizes ({sizes.join(" ")})
                      </Button>
                      <details className="text-[12px] text-text-dim">
                        <summary className="cursor-pointer hover:text-accent">Paste a table from Excel</summary>
                        <textarea
                          value={chartPaste}
                          onChange={(e) => setChartPaste(e.target.value)}
                          rows={4}
                          placeholder={"Size\tBust\tLength\nS\t86\t120"}
                          className="w-full mt-2 px-3 py-2 rounded-[10px] bg-bg-elev-2 border border-border text-[12px] font-mono"
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          className="mt-2"
                          onClick={() => {
                            const c = parseChartText(chartPaste);
                            if (c) {
                              setChart(c.headers.length ? c : { headers: c.rows[0].map((_, i) => (i === 0 ? "Size" : "")), rows: c.rows });
                              setChartPaste("");
                            }
                          }}
                          disabled={!parseChartText(chartPaste)}
                        >
                          Use this table
                        </Button>
                      </details>
                    </div>
                  </>
                )}
              </Card>

              {/* 4. colours */}
              <Card
                n="4"
                title="Colours"
                hint="Rename changes the colour swatch, page title and SKUs — the web address stays the same, so ads and links keep working. Hide sets the colour to draft (nothing is deleted)."
              >
                {notInQuote > 0 && (
                  <div className="mb-3">
                    <Banner tone="warning">
                      The supplier didn&apos;t list {notInQuote} of these colours. Hide them only if the supplier really doesn&apos;t have them — a colour
                      can also just be missing from a screenshot.
                    </Banner>
                  </div>
                )}
                <div className="space-y-2.5">
                  {family.rows.map((r) => {
                    const act = colourActions[r.row_id] ?? { action: "keep", labels: {} };
                    const set = (next: Partial<ColourAction>) =>
                      setColourActions((prev) => ({ ...prev, [r.row_id]: { ...act, ...next } }));
                    return (
                      <div key={r.row_id} className={`rounded-xl border p-3 ${act.action === "drop" ? "border-danger/40" : "border-border"}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12.5px] font-medium text-text">
                            {presentStores.map((s) => r.cells[s]?.colour).filter(Boolean).join(" / ")}
                          </span>
                          {act.notInQuote && (
                            <span className="text-[10.5px] px-1.5 rounded bg-warning/15 text-warning">not in the supplier&apos;s list</span>
                          )}
                          <span className="flex-1" />
                          <Pill on={act.action === "keep"} onClick={() => set({ action: "keep" })}>Keep</Pill>
                          <Pill
                            on={act.action === "rename"}
                            onClick={() =>
                              set({
                                action: "rename",
                                labels: Object.keys(act.labels).length
                                  ? act.labels
                                  : Object.fromEntries(presentStores.map((s) => [s, r.cells[s]?.colour ?? ""])),
                              })
                            }
                          >
                            Rename
                          </Pill>
                          <Pill on={act.action === "drop"} onClick={() => set({ action: "drop" })} title="Set to draft: hidden from the shop, nothing deleted">
                            Hide
                          </Pill>
                        </div>
                        {act.action === "rename" && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                            {presentStores.map((s) =>
                              r.cells[s] ? (
                                <label key={s} className="text-[11px] text-text-faint">
                                  {AQ_STORE_LABEL[s]}
                                  <input
                                    value={act.labels[s] ?? ""}
                                    onChange={(e) => set({ labels: { ...act.labels, [s]: e.target.value } })}
                                    className={inputCls}
                                  />
                                </label>
                              ) : null
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 space-y-2.5">
                  {newColours.map((c) => (
                    <div key={c.id} className="rounded-xl border border-accent/40 p-3">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-[12.5px] font-medium text-text">New colour{c.supplier ? ` — supplier: ${c.supplier}` : ""}</span>
                        <span className="flex-1" />
                        <label className="flex items-center gap-1.5 text-[11.5px] text-text-dim" title="Off: the colour is created as a draft so you can check it in Shopify first">
                          <input
                            type="checkbox"
                            checked={c.activate}
                            onChange={(e) => setNewColours((p) => p.map((x) => (x.id === c.id ? { ...x, activate: e.target.checked } : x)))}
                            className="h-3.5 w-3.5 accent-[var(--accent)]"
                          />
                          Put live right away
                        </label>
                        <button type="button" onClick={() => setNewColours((p) => p.filter((x) => x.id !== c.id))} className="text-[11.5px] text-text-faint hover:text-danger">
                          Remove
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {presentStores.map((s) => (
                          <label key={s} className="text-[11px] text-text-faint">
                            {AQ_STORE_LABEL[s]} name
                            <input
                              value={c.labels[s]}
                              onChange={(e) =>
                                setNewColours((p) => p.map((x) => (x.id === c.id ? { ...x, labels: { ...x.labels, [s]: e.target.value } } : x)))
                              }
                              className={inputCls}
                            />
                          </label>
                        ))}
                      </div>
                      <div className="mt-2">
                        <DropZone
                          label={c.images.length ? "Add more photos of this colour" : "Photos of this colour (required)"}
                          accept="image/*"
                          busy={photoBusy > 0}
                          onFiles={(fs) =>
                            void addPhotos(fs, (ups) =>
                              setNewColours((p) => p.map((x) => (x.id === c.id ? { ...x, images: [...x.images, ...ups].slice(0, 10) } : x)))
                            )
                          }
                        />
                        <Thumbs
                          items={c.images}
                          onRemove={(i) => setNewColours((p) => p.map((x) => (x.id === c.id ? { ...x, images: x.images.filter((_, j) => j !== i) } : x)))}
                        />
                      </div>
                    </div>
                  ))}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setNewColours((p) => [...p, { id: newId(), labels: { dk: "", fr: "", fi: "" }, images: [], activate: false }])}
                  >
                    ＋ Add a colour the supplier has
                  </Button>
                </div>
              </Card>

              {/* 5. photos */}
              <Card n="5" title="Real photos (optional)" hint="Photos from the supplier per colour — added to that colour in every chosen store.">
                {photoErr && <div className="mb-3"><Banner tone="warning">{photoErr}</Banner></div>}
                <div className="space-y-2.5">
                  {family.rows
                    .filter((r) => (colourActions[r.row_id]?.action ?? "keep") !== "drop")
                    .map((r) => {
                      const ph = photos[r.row_id] ?? { mode: "append", images: [] };
                      const set = (next: Partial<PhotoSet>) => setPhotos((prev) => ({ ...prev, [r.row_id]: { ...(prev[r.row_id] ?? ph), ...next } }));
                      return (
                        <div key={r.row_id} className="rounded-xl border border-border p-3">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="text-[12.5px] font-medium text-text">
                              {presentStores.map((s) => r.cells[s]?.colour).filter(Boolean).join(" / ")}
                            </span>
                            <span className="flex-1" />
                            <Pill on={ph.mode === "append"} onClick={() => set({ mode: "append" })}>Add at the end</Pill>
                            <Pill on={ph.mode === "front"} onClick={() => set({ mode: "front" })} title="The first new photo becomes the main photo">
                              Put first
                            </Pill>
                          </div>
                          <DropZone
                            label="Drop photos of this colour"
                            accept="image/*"
                            busy={photoBusy > 0}
                            onFiles={(fs) =>
                              void addPhotos(fs, (ups) =>
                                setPhotos((prev) => {
                                  const cur = prev[r.row_id] ?? { mode: "append" as const, images: [] };
                                  return { ...prev, [r.row_id]: { ...cur, images: [...cur.images, ...ups].slice(0, 10) } };
                                })
                              )
                            }
                          />
                          <Thumbs items={ph.images} onRemove={(i) => set({ images: ph.images.filter((_, j) => j !== i) })} />
                        </div>
                      );
                    })}
                </div>
              </Card>

              {/* 6. facts → description */}
              <Card
                n="6"
                title="Material & details → description"
                hint="What the supplier confirmed about the real product. AI corrects each store's description where it contradicts these facts and adds the material — in the store's own language, nothing else changes. Optional."
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="text-[11px] text-text-faint">
                    Material
                    <input value={material} onChange={(e) => setMaterial(e.target.value)} className={inputCls} placeholder="e.g. 95% polyester, 5% elastane" />
                  </label>
                  <label className="text-[11px] text-text-faint">
                    Styles the supplier offers (one per line)
                    <textarea
                      value={modelsText}
                      onChange={(e) => setModelsText(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 rounded-[10px] bg-bg-elev-2 border border-border text-[12.5px] text-text focus:outline-none focus:border-accent"
                      placeholder="Long sleeve — lined"
                    />
                  </label>
                </div>
                <label className="block text-[11px] text-text-faint mt-2">
                  Facts (one per line)
                  <textarea
                    value={factsText}
                    onChange={(e) => setFactsText(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 rounded-[10px] bg-bg-elev-2 border border-border text-[12.5px] text-text focus:outline-none focus:border-accent"
                    placeholder={"Length 118 cm\nFully lined\nHidden zip at the back"}
                  />
                </label>
                <div className="flex items-center gap-3 mt-3 flex-wrap">
                  <Button variant="secondary" size="sm" onClick={() => void runCopy()} disabled={copyBusy || (!material.trim() && !factsText.trim() && !modelsText.trim())}>
                    {copyBusy ? "Writing…" : "Suggest corrected descriptions"}
                  </Button>
                  {copyErr && <span className="text-[12px] text-danger">{copyErr}</span>}
                </div>
                {Object.keys(copy).length > 0 && (
                  <div className="mt-4 space-y-3">
                    {AQ_STORES.filter((s) => copy[s]).map((s) => {
                      const c = copy[s] as AqCopy;
                      const same = c.after === c.before;
                      return (
                        <div key={s} className="rounded-xl border border-border p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-[12.5px] font-semibold text-text">{AQ_STORE_LABEL[s]}</span>
                            <span className="text-[11.5px] text-text-faint">{same ? "no change needed" : c.changes.join(" · ")}</span>
                            <span className="flex-1" />
                            {!same && (
                              <label className="flex items-center gap-1.5 text-[11.5px] text-text-dim">
                                <input
                                  type="checkbox"
                                  checked={!!copyUse[s]}
                                  onChange={(e) => setCopyUse((p) => ({ ...p, [s]: e.target.checked }))}
                                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                                />
                                Use this
                              </label>
                            )}
                          </div>
                          {c.warnings.map((w, i) => (
                            <div key={i} className="mb-2">
                              <Banner tone="warning">{w}</Banner>
                            </div>
                          ))}
                          {!same && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <div className="text-[10.5px] uppercase tracking-wide text-text-faint mb-1">Now</div>
                                <div className="text-[12px] text-text-dim whitespace-pre-wrap max-h-56 overflow-y-auto">{textOf(c.before)}</div>
                              </div>
                              <div>
                                <div className="text-[10.5px] uppercase tracking-wide text-text-faint mb-1">New (HTML — edit if needed)</div>
                                <textarea
                                  value={c.after}
                                  onChange={(e) => setCopy((p) => ({ ...p, [s]: { ...c, after: e.target.value } }))}
                                  rows={9}
                                  className="w-full px-2.5 py-2 rounded-[10px] bg-bg-elev-2 border border-border text-[11.5px] font-mono text-text focus:outline-none focus:border-accent"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* 7. review + apply */}
              <Card n="7" title="Preview and apply" hint="Nothing is written until you press Apply. The preview re-reads the listing from Shopify.">
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <span className="text-[12px] text-text-dim">Stores:</span>
                  {presentStores.map((s) => (
                    <Pill
                      key={s}
                      on={stores.includes(s)}
                      onClick={() => setStores((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))}
                    >
                      {AQ_STORE_LABEL[s]}
                    </Pill>
                  ))}
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Button variant="secondary" onClick={() => void runPlan()} disabled={planning || jobRunning || !stores.length || photoBusy > 0}>
                    {planning ? "Checking…" : "Preview changes"}
                  </Button>
                  <Button
                    variant="publish"
                    onClick={() => void runApply()}
                    disabled={!planIsFresh || !plan || plan.errors.length > 0 || plan.ops.length === 0 || jobRunning || photoBusy > 0}
                    title={!planIsFresh ? "Preview first — the form changed since the last preview" : undefined}
                  >
                    {jobRunning && job?.kind !== "undo" ? (job ? `Writing… ${job.done}/${job.total}` : "Uploading…") : "Apply to Shopify"}
                  </Button>
                  {plan && !planIsFresh && <span className="text-[12px] text-warning">The form changed — preview again.</span>}
                  {photoBusy > 0 && <span className="text-[12px] text-text-faint">Preparing photos…</span>}
                </div>
                {planErr && <div className="mt-3"><Banner tone="danger">{planErr}</Banner></div>}
                {plan && (
                  <div className="mt-4 space-y-2">
                    {plan.errors.map((e, i) => (
                      <Banner key={`e${i}`} tone="danger">
                        {e}
                      </Banner>
                    ))}
                    {plan.warnings.map((w, i) => (
                      <Banner key={`w${i}`} tone="warning">
                        {w}
                      </Banner>
                    ))}
                    {plan.ops.length === 0 && !plan.errors.length && <Banner tone="info">Nothing to change — the listing already matches.</Banner>}
                    {plan.ops.length > 0 && (
                      <div className="rounded-xl border border-border divide-y divide-border">
                        {AQ_STORES.filter((s) => plan.ops.some((o) => o.store === s)).map((s) => (
                          <div key={s} className="p-3">
                            <div className="text-[12px] font-semibold text-text mb-1">
                              {AQ_STORE_LABEL[s]} <span className="font-normal text-text-faint">— {plan.ops.filter((o) => o.store === s).length} change(s)</span>
                            </div>
                            <ul className="text-[12px] space-y-0.5">
                              {plan.ops
                                .filter((o) => o.store === s)
                                .map((o, i) => (
                                  <li key={i} className={o.op === "draft" ? "text-danger" : "text-text-dim"}>
                                    • {o.text}
                                  </li>
                                ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {jobErr && <div className="mt-3"><Banner tone="danger">{jobErr}</Banner></div>}
                {job && (
                  <div className="mt-4 rounded-xl border border-border p-3">
                    <div className="text-[12.5px] font-semibold text-text">
                      {job.kind === "undo" ? "Undo" : "Apply"}:{" "}
                      {job.status === "running"
                        ? `${job.step}… ${job.done}/${job.total || "?"}`
                        : job.status === "done"
                          ? "done ✓"
                          : job.status === "partial"
                            ? "done with problems — see below"
                            : "stopped"}
                    </div>
                    {job.errors.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {job.errors.map((e, i) => (
                          <Banner key={i} tone="danger">
                            {e}
                          </Banner>
                        ))}
                      </div>
                    )}
                    <ul className="mt-2 text-[11.5px] space-y-0.5 max-h-60 overflow-y-auto">
                      {job.log.map((l, i) => (
                        <li key={i} className={l.ok ? "text-text-dim" : "text-danger"}>
                          {l.ok ? "✓" : "✕"} {l.store.toUpperCase()} · {l.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>

              {/* history */}
              {family.history.length > 0 && (
                <Card title="Changes made with this tool" hint="Newest first. Undo takes back what a change wrote — newest first, and only fields nobody changed since.">
                  <ul className="space-y-2">
                    {family.history.map((h) => (
                      <li key={h.backup_id} className="rounded-xl border border-border p-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12.5px] font-medium text-text">{new Date(h.ts).toLocaleString("en-GB")}</span>
                          <span className="text-[11.5px] text-text-faint">{h.user}</span>
                          {h.undone && <span className="text-[10.5px] px-1.5 rounded bg-bg-elev-2 text-text-faint">undone</span>}
                          {h.status === "interrupted" && (
                            <span className="text-[10.5px] px-1.5 rounded bg-warning/15 text-warning" title="The server stopped halfway — check the listing, or undo">
                              interrupted
                            </span>
                          )}
                          {h.status === "error" && <span className="text-[10.5px] px-1.5 rounded bg-bg-elev-2 text-text-faint">stopped — nothing written</span>}
                          {h.errors?.length > 0 && h.status !== "error" && (
                            <span className="text-[10.5px] px-1.5 rounded bg-danger/15 text-danger">{h.errors.length} problem(s)</span>
                          )}
                          <span className="flex-1" />
                          {newestUndoable?.backup_id === h.backup_id && (
                            <Button variant="ghost" size="sm" onClick={() => void runUndo(h.backup_id)} disabled={jobRunning}>
                              Undo
                            </Button>
                          )}
                        </div>
                        <ul className="mt-1 text-[11.5px] text-text-dim space-y-0.5">
                          {Object.entries(h.summary || {}).flatMap(([s, lines]) =>
                            (lines || []).slice(0, 6).map((t, i) => (
                              <li key={`${s}${i}`}>
                                {s.toUpperCase()} · {t}
                              </li>
                            ))
                          )}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// ── size chart view/editor ───────────────────────────────────────────────────

function ChartView({ chart }: { chart: AqChart }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-[12px] border-collapse">
        {chart.headers.length > 0 && (
          <thead>
            <tr>
              {chart.headers.map((h, i) => (
                <th key={i} className="text-left font-medium text-text-faint px-2 py-1 border-b border-border">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {chart.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`px-2 py-1 border-b border-border ${j === 0 ? "font-medium text-text" : "text-text-dim"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartEditor({ chart, onChange }: { chart: AqChart; onChange: (c: AqChart) => void }) {
  const width = Math.max(chart.headers.length, ...chart.rows.map((r) => r.length), 2);
  const headers = [...chart.headers, ...Array(Math.max(0, width - chart.headers.length)).fill("")];
  const rows = chart.rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill("")]);
  const cell = "w-full min-w-[70px] px-2 h-8 rounded-md bg-bg-elev-2 border border-border text-[12px] text-text focus:outline-none focus:border-accent";
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1">
        <thead>
          <tr>
            {headers.map((h, j) => (
              <th key={j} className="align-bottom">
                <div className="flex items-center gap-0.5">
                  <input
                    value={h}
                    onChange={(e) => onChange({ headers: headers.map((x, k) => (k === j ? e.target.value : x)), rows })}
                    className={`${cell} font-medium`}
                    placeholder={j === 0 ? "Size" : "Measure (cm)"}
                    aria-label={`Column ${j + 1} header`}
                  />
                  {width > 2 && (
                    <button
                      type="button"
                      onClick={() => onChange({ headers: headers.filter((_, k) => k !== j), rows: rows.map((r) => r.filter((_, k) => k !== j)) })}
                      className="text-[11px] text-text-faint hover:text-danger px-0.5"
                      aria-label={`Remove column ${j + 1}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              </th>
            ))}
            <th>
              <button
                type="button"
                onClick={() => onChange({ headers: [...headers, ""], rows: rows.map((r) => [...r, ""]) })}
                className="text-[11.5px] text-accent hover:underline whitespace-nowrap"
              >
                + column
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>
                  <input
                    value={c}
                    onChange={(e) =>
                      onChange({ headers, rows: rows.map((row, k) => (k === i ? row.map((x, m) => (m === j ? e.target.value : x)) : row)) })
                    }
                    className={cell}
                    aria-label={`Row ${i + 1} column ${j + 1}`}
                  />
                </td>
              ))}
              <td>
                <button
                  type="button"
                  onClick={() => onChange({ headers, rows: rows.filter((_, k) => k !== i) })}
                  className="text-[11px] text-text-faint hover:text-danger px-1"
                  aria-label={`Remove row ${i + 1}`}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => onChange({ headers, rows: [...rows, Array(width).fill("")] })}
        className="text-[11.5px] text-accent hover:underline mt-1"
      >
        + row
      </button>
    </div>
  );
}
