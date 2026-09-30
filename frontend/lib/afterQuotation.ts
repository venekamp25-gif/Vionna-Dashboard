/**
 * After Quotation — pure helpers (no React, no DOM) so node tests can run them.
 *
 * The page corrects fashion listings once the supplier's quote is in. These
 * helpers turn what the operator types or pastes ("S-2XL", "35–41", a size
 * chart copied from Excel) into the exact values the backend expects. The
 * backend normalises again (server.py `_aq_norm_size`); keep both in step.
 */

export type AqStore = "dk" | "fr" | "fi";
export const AQ_STORES: AqStore[] = ["dk", "fr", "fi"];
export const AQ_STORE_LABEL: Record<AqStore, string> = { dk: "DK", fr: "FR", fi: "FI" };

export interface AqChart {
  headers: string[];
  rows: string[][];
}

export const LETTER_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];

const ALIASES: Record<string, string> = {
  XXL: "2XL",
  XXXL: "3XL",
  XXXXL: "4XL",
  XXXXXL: "5XL",
  SMALL: "S",
  MEDIUM: "M",
  LARGE: "L",
  XSMALL: "XS",
  XLARGE: "XL",
  "X-SMALL": "XS",
  "X-LARGE": "XL",
  "XX-LARGE": "2XL",
  XXLARGE: "2XL",
};
const ONE_SIZE = new Set(["ONESIZE", "OS", "FREESIZE", "FREE", "TAILLEUNIQUE", "YKSIKOKO", "ONESIZEFITSALL"]);

/** One spelling per size: "xxl" → "2XL", "EU 38" → "38", "one size" → "One Size". */
export function normSize(raw: string): string {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const u = t.toUpperCase().replace(/ /g, "");
  if (ALIASES[u]) return ALIASES[u];
  if (LETTER_SIZES.includes(u)) return u;
  if (ONE_SIZE.has(u.normalize("NFKD").replace(/[̀-ͯ]/g, ""))) return "One Size";
  const m = u.match(/^(?:EU|EUR|FR|DK)?(\d{2,3}(?:[.,]5)?)$/);
  if (m) return m[1].replace(",", ".");
  return t.slice(0, 20);
}

export type SizeKind = "letter" | "number" | "one" | "other";

export function sizeKind(sizes: string[]): SizeKind {
  const ns = sizes.map(normSize).filter(Boolean);
  if (!ns.length) return "other";
  if (ns.every((x) => x === "One Size")) return "one";
  if (ns.every((x) => LETTER_SIZES.includes(x))) return "letter";
  if (ns.every((x) => /^\d{2,3}(\.5)?$/.test(x))) return "number";
  return "other";
}

/** Smallest first for letter or number lists; mixed lists keep their order. */
export function sortSizes(sizes: string[]): string[] {
  const ns = [...new Set(sizes.map(normSize).filter(Boolean))];
  const kind = sizeKind(ns);
  if (kind === "letter") return ns.sort((a, b) => LETTER_SIZES.indexOf(a) - LETTER_SIZES.indexOf(b));
  if (kind === "number") return ns.sort((a, b) => parseFloat(a) - parseFloat(b));
  return ns;
}

/**
 * What the operator typed → sizes. Understands lists ("S, M, L"), ranges
 * ("S-2XL", "35–41", "36-46 step 2" as "36-46/2") and "One size".
 */
export function parseSizeList(text: string): string[] {
  const cleaned = String(text ?? "")
    .replace(/[–—]/g, "-")
    // one-size words first: "Taille unique" must not lose "Taille" to the strip below
    .replace(/one\s*size(?:\s*fits\s*all)?|taille\s*unique|yksi\s*koko|free\s*size/gi, " ONESIZE ")
    .replace(/\s+(?:to|til|à|bis|-)\s+/gi, "-") // "S to 2XL"
    .replace(/\bEUR?\s*(?=\d)/gi, "") // "EU 36", "EU36-EU42"
    .replace(/\b(?:sizes?|tailles?|str|størrelser?|koot?)\b\.?:?/gi, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s*\/\s*/g, "/");
  const out: string[] = [];
  // "36,5" is one size; "36, 38" and "36,38" are two
  for (const tok of cleaned.split(/,(?!5(?!\d))|[;\s]+/).filter(Boolean)) {
    // numeric range, optional step: "35-41", "36-46/2"
    const num = tok.match(/^(\d{2,3})-(\d{2,3})(?:\/(\d))?$/);
    if (num) {
      const a = parseInt(num[1], 10);
      const b = parseInt(num[2], 10);
      const step = num[3] ? parseInt(num[3], 10) : 1;
      if (b >= a && b - a <= 40 && step >= 1) {
        for (let n = a; n <= b; n += step) out.push(String(n));
        continue;
      }
    }
    // "S/M" and "L/XL" (two neighbouring sizes) are ONE combined size, as the
    // backend keeps them; "S/M/L" is a list; "S-2XL" a letter range
    const slash = tok.split("/").filter(Boolean);
    if (slash.length === 2) {
      const a = LETTER_SIZES.indexOf(normSize(slash[0]));
      const b = LETTER_SIZES.indexOf(normSize(slash[1]));
      if (a >= 0 && b === a + 1) {
        out.push(`${LETTER_SIZES[a]}/${LETTER_SIZES[b]}`);
        continue;
      }
    }
    for (const p of slash) {
      const r = p.match(/^([A-Z0-9]{1,6})-([A-Z0-9]{1,6})$/i);
      if (r) {
        const a = LETTER_SIZES.indexOf(normSize(r[1]));
        const b = LETTER_SIZES.indexOf(normSize(r[2]));
        if (a >= 0 && b >= a) {
          out.push(...LETTER_SIZES.slice(a, b + 1));
          continue;
        }
      }
      const n = normSize(p);
      if (n) out.push(n);
    }
  }
  return sortSizes(out);
}

export const SIZE_PRESETS: { label: string; text: string }[] = [
  { label: "XS–XL", text: "XS-XL" },
  { label: "S–XL", text: "S-XL" },
  { label: "S–2XL", text: "S-2XL" },
  { label: "S–3XL", text: "S-3XL" },
  { label: "EU 34–44", text: "34-44/2" },
  { label: "EU 36–46", text: "36-46/2" },
  { label: "Shoes 35–41", text: "35-41" },
  { label: "Shoes 36–42", text: "36-42" },
  { label: "One Size", text: "One Size" },
];

/** A table pasted from Excel / Google Sheets / a chat → {headers, rows}. */
export function parseChartText(text: string): AqChart | null {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim());
  if (lines.length < 2) return null;
  // ONE separator for the whole paste — chosen per line, a CSV header split on
  // commas while its data rows (86,5) did not, and the columns shifted
  const most = (re: RegExp) => lines.filter((l) => re.test(l)).length >= Math.ceil(lines.length / 2);
  const commas = (l: string) => (l.match(/,/g) ?? []).length;
  const split: (l: string) => string[] = most(/\t/)
    ? (l) => l.split("\t")
    : most(/;/)
      ? (l) => l.split(";")
      : most(/\S\s{2,}\S/)
        ? (l) => l.trim().split(/\s{2,}/)
        : commas(lines[0]) >= 1 && lines.every((l) => commas(l) === commas(lines[0]))
          ? (l) => l.split(",")
          : (l) => l.trim().split(/\s+/);
  const grid = lines.map((l) => split(l).map((c) => c.trim()));
  const width = Math.max(...grid.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(Math.max(0, width - r.length)).fill("")].slice(0, 20);
  const first = grid[0];
  const isNum = (c: string) => /^[\d.,/\s-]+$/.test(c);
  const isSize = (c: string) => sizeKind([c]) !== "other";
  // a header row has words where the data rows have numbers — or starts with a
  // label ("EU 35 36 37" on a transposed shoe chart)
  const isHeader =
    first.slice(1).some((c) => c && !isNum(c) && !isSize(c)) || (!!first[0] && !isNum(first[0]) && !isSize(first[0]));
  const headers = isHeader ? pad(first) : [];
  const rows = (isHeader ? grid.slice(1) : grid).map(pad).filter((r) => r.some((c) => c));
  return rows.length ? { headers, rows: rows.slice(0, 60) } : null;
}

/** Sizes a chart describes (first column, or a transposed header row). */
export function chartSizes(chart: AqChart | null | undefined): string[] {
  if (!chart) return [];
  const firsts = chart.rows.map((r) => normSize(r[0] ?? "")).filter(Boolean);
  const heads = chart.headers.slice(1).map(normSize).filter(Boolean);
  const sizeish = (xs: string[]) =>
    xs.length >= 2 && xs.filter((x) => sizeKind([x]) !== "other").length >= Math.max(2, 0.7 * xs.length);
  if (sizeish(firsts)) return firsts;
  if (sizeish(heads)) return heads;
  return [];
}

/** true/false when both are the same kind of size; null when not comparable. */
export function sizesMatchChart(sizes: string[], chart: AqChart | null | undefined): boolean | null {
  const cs = chartSizes(chart);
  const a = sizes.map(normSize).filter(Boolean);
  if (!a.length || !cs.length) return null;
  const ka = sizeKind(a);
  if (ka !== sizeKind(cs) || ka === "other" || ka === "one") return null;
  const sa = new Set(a);
  return cs.length === sa.size && cs.every((x) => sa.has(x));
}

/** A blank chart with one row per size — the fastest start when the supplier
 *  only sent measurements in a chat message. */
export function chartForSizes(
  sizes: string[],
  headers = ["Size", "Bust (cm)", "Waist (cm)", "Hips (cm)", "Length (cm)"],
  existing?: AqChart | null
): AqChart {
  // keep the measurements already typed for a size that stays
  const had = new Map((existing?.rows ?? []).map((r) => [normSize(r[0] ?? ""), r] as const));
  return {
    headers: [...headers],
    rows: sizes.map((s) => {
      const old = had.get(normSize(s));
      return old ? [s, ...headers.slice(1).map((_, i) => old[i + 1] ?? "")] : [s, ...Array(headers.length - 1).fill("")];
    }),
  };
}

/** Stable text of a target — tells whether the preview on screen still
 *  describes what Apply would send. A photo counts by its size and last bytes
 *  (cheap, and a swapped photo changes it), never by its full data. */
export function targetFingerprint(target: unknown): string {
  return JSON.stringify(target, (_k, v) =>
    typeof v === "string" && v.startsWith("data:") ? `img:${v.length}:${v.slice(-24)}` : v
  );
}

// ── the listing list: filtered in the browser (no request per keystroke) ─────

export interface AqOrders {
  first: string;
  last: string;
  count: number;
  /** false = the colour group existed before order tracking started, so an
   *  earlier first order can't be ruled out */
  first_known: boolean;
}

/** One colour group as /api/aq/list sends it (slim). */
export interface AqListEntry {
  key: string;
  name: string;
  cat: string;
  type: string;
  image: string;
  created: string;
  stores: Partial<Record<AqStore, number>>;
  active: number;
  total: number;
  sizes: string[];
  colours: Partial<Record<AqStore, string>>[];
  flags: { code: string; hard: boolean; text: string }[];
  processed: string | null;
  orders: AqOrders | null;
  /** recommended rank [tier, date]: 3 first order known, 2 ordered (first order
   *  unknown), 1 needs attention; null = not recommended */
  rec: [number, string] | null;
  /** in "Needs attention" (the server owns the 60-day rule) */
  att: boolean;
  /** accent-free names + colour/handle text, prepared by the server */
  names: string[];
  hay: string;
}

export type AqView = "recommended" | "attention" | "recent" | "done";

const NORDIC: Record<string, string> = { ø: "o", æ: "ae", å: "a", ß: "ss", ð: "d", þ: "th" };

/** Port of server `_deaccent`: lowercase, Nordic letters first (NFKD doesn't
 *  split ø/æ), then accents off — "Mørkegrøn" → "morkegron", "Zoé" → "zoe". */
export function deaccent(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[øæåßðþ]/g, (c) => NORDIC[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

/** Links, product ids and competitor URLs are looked up by the server (it
 *  knows handles and the publish history); plain words are filtered here. */
export function isServerQuery(q: string): boolean {
  const t = q.trim();
  return /\/products\/\S+/.test(t) || /^\d{8,}$/.test(t) || /^https?:\/\//i.test(t) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(t);
}

/** Same scoring as server `_aq_search`: exact name 90, name prefix 70, name
 *  part 50, colour/handle 30; no query → the view's own filter and order. */
export function filterFamilies(list: AqListEntry[], q: string, view: AqView): AqListEntry[] {
  const needle = deaccent(q.trim());
  const scored: { e: AqListEntry; k: [number, string] }[] = [];
  for (const e of list) {
    if (needle) {
      let score = 0;
      if (e.names.includes(needle)) score = 90;
      else if (e.names.some((n) => n.startsWith(needle))) score = 70;
      else if (e.names.some((n) => n.includes(needle))) score = 50;
      else if (e.hay.includes(needle)) score = 30;
      if (score) scored.push({ e, k: [score, e.created || ""] });
      continue;
    }
    if (view === "recommended") {
      if (e.rec) scored.push({ e, k: [e.rec[0], e.rec[1] || ""] });
    } else if (view === "attention") {
      if (e.att) scored.push({ e, k: [0, e.created || ""] });
    } else if (view === "done") {
      if (e.processed) scored.push({ e, k: [0, e.processed] });
    } else {
      scored.push({ e, k: [0, e.created || ""] });
    }
  }
  scored.sort((a, b) => b.k[0] - a.k[0] || (a.k[1] < b.k[1] ? 1 : a.k[1] > b.k[1] ? -1 : 0));
  return scored.map((x) => x.e);
}

/** "1st order 28 Sep · 3 orders" — honest when the first order isn't certain. */
export function orderBadge(o: AqOrders | null | undefined, now: Date = new Date()): string | null {
  if (!o) return null;
  // calendar days in the viewer's timezone: an order at 22:00 yesterday is
  // "yesterday" at 08:00 today, not "today" (review 30 Sep)
  const sod = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const day = (iso: string) => {
    const d = new Date(iso);
    const days = Math.round((sod(now) - sod(d)) / 86_400_000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };
  const n = `${o.count} order${o.count === 1 ? "" : "s"}`;
  return o.first_known ? `1st order ${day(o.first)} · ${n}` : `ordered ${day(o.last)} · ${n} (earlier orders unknown)`;
}
