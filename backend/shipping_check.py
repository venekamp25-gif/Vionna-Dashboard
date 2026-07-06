"""Classify a Shopify store's shipping policy as dropshipper / own-stock / unknown.

Accuracy layers (in order, first confident hit wins):
1. Schema.org JSON-LD `shippingDetails` (handlingTime + transitTime) — structured, high precision
2. Regex over policy text: processing-time + delivery-time, unit-aware
   (business days / calendar days / WEEKS / HOURS), summed; ignores return windows
3. (browser render — skipped in fast mode)
4. Text-LLM (Haiku) — few-shot; used to corroborate borderline/low-confidence
   regex results, with a Sonnet tiebreaker on disagreement
5. Vision-LLM (skipped in fast mode)

Total delivery >= 5 days  -> 'Dropshipper'
Total delivery  < 5 days  -> 'Eigen voorraad'
no info found             -> 'Onbekend'

classify_detailed() returns {label, lo, hi, detail, source, confidence}.
check_shipping() keeps the legacy 'Label (X-Yd)' string API.
"""
import os
import re
import sys
import json as _json
from urllib.parse import urlparse
import requests

_CACHE: dict = {}
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

POLICY_PATHS = (
    "/policies/shipping-policy",
    "/policies/shipping",
    "/policies/refund-policy",
    "/pages/shipping-policy",
    "/pages/shipping",
    "/pages/verzending",
    "/pages/verzendbeleid",
    "/pages/verzending-en-retour",
    "/pages/verzending-retour",
    "/pages/levertijd",
    "/pages/levertijden",
    "/pages/delivery",
    "/pages/levering",
    "/pages/livraison",
    "/pages/versand",
    "/pages/fragt",
    "/pages/leverans",
    "/pages/faq",
    "/pages/algemene-voorwaarden",
    "/pages/track-my-order",
    "/pages/order-tracking",
    "/pages/track-order",
    "/pages/customer-service",
    "/pages/customer-care",
    "/pages/help",
    "/pages/help-center",
    "/pages/about-shipping",
    "/pages/shipping-info",
    "/pages/shipping-information",
    "/pages/our-policy",
    "/pages/contact",
    "/pages/faq-shipping",
    "/pages/shipping-and-delivery",
    "/pages/shipping-delivery",
    "/pages/leveringstid",
    "/pages/leveringsbetingelser",
    "/pages/lieferzeit",
    "/pages/conditions-livraison",
    "/pages/livraison-et-retours",
)

_SHIPPING_WORDS = ("verzend", "shipping", "delivery", "levering", "livraison",
                   "versand", "fragt", "leverans", "lieferzeit", "leveringstid")

_URL_SHIPPING_HINTS = ("shipping", "verzend", "deliver", "lever", "fragt", "leverans",
                       "livraison", "versand", "expedition", "expédition")

SHIPPING_CONTEXT_NEAR = (
    "shipping", "delivery", "verzend", "levering", "leveranstid", "leveringstid",
    "fragt", "frakt", "leverans", "lieferzeit", "livraison", "versand",
    "verzendtijd", "levertijd", "verzendbeleid", "deliver", "arrive", "bezorg",
)

# Return/warranty words that must NOT be near a number we treat as delivery time
_RETURN_NEG = ("retour", "return", "refund", "garantie", "guarantee", "warranty",
               "tilbagebetaling", "terugbetaling", "remboursement", "rückgabe",
               "widerruf", "ångerrätt", "retur", "money back", "money-back",
               "exchange", "ruilen", "umtausch", "échange")

# Processing-context words: a duration sitting next to one of these inside a
# delivery section is the order-processing time, not the transit time — skip it
# when isolating the delivery range (so a "prepare within 3 days ... ships in 5-9
# days" policy yields delivery=5-9, not 3).
_PROC_CONTEXT_WORDS = (
    "verwerk", "verpak", "wij verpakken", "process", "processing", "handling",
    "preparation", "we pack", "shipping out", "dispatch", "dispatched", "bearbeit",
    "förbereder", "förbereda", "forbereder", "packar", "att packa", "bearbeta",
    "behandling", "handläggn", "handlaggn", "pakker", "afsendes",
)

# ── Duration parsing (idea 1+4: unit-aware — biz days / calendar days / weeks / hours) ──
_WEEK = r"weken|weke|weeks|week|wochen|woche|semaines|semaine|veckor|vecka|uger|uge|uke"
_HOUR = r"uren|uur|hours|hour|stunden|stunde|heures|heure|timmar|timer|timen"
_DAY  = (r"werkdagen|werkdage|werktagen|werktage|vardagar|arbetsdagar|arbejdsdage|"
         r"hverdage|hverdager|jours\s*ouvr\w*|business\s*days|werkdag|"
         r"dagen|dagar|dage|tage|jours|jour|days|day|dag")
_SEP = r"(?:[-–—]|t/m|tot\s+en\s+met|tot|to|till|bis)"  # no bare '/' (kills "24/7 days")
_DUR_RE = re.compile(
    rf"(\d{{1,2}})(?:\s*{_SEP}\s*(\d{{1,2}}))?\s*(?P<unit>{_WEEK}|{_HOUR}|{_DAY})",
    re.IGNORECASE,
)


def _to_days(lo: int, hi: int, unit: str) -> tuple[int, int]:
    """Normalise a (lo, hi, unit) duration to a day-range."""
    u = (unit or "").lower()
    if re.match(rf"(?:{_WEEK})$", u):
        return lo * 7, hi * 7
    if re.match(rf"(?:{_HOUR})$", u):
        return max(1, round(lo / 24)), max(1, round(hi / 24))
    return lo, hi


def _dur_days(m: re.Match) -> tuple[int, int]:
    lo = int(m.group(1))
    hi = int(m.group(2)) if m.group(2) else lo
    lo, hi = _to_days(lo, hi, m.group("unit"))
    return tuple(sorted((lo, hi)))


# Order processing vs delivery triggers (which sentence the number belongs to)
PROCESSING_TRIGGER_RE = re.compile(
    r"(?:"
    r"verwerk\w*|verwerkings?tijd|"
    r"wij\s+verpakken|we\s+verpakken|verzenden\s+uw\s+bestelling|"
    r"verzonden\s+binnen|verzenden\s+binnen|"
    r"order\s+processing|processing\s+time|preparation\s+time|"
    r"we\s+pack|we\s+process|ship(?:ped)?\s+out|shipping\s+out|"
    r"dispatch(?:ed)?\s+within|dispatch\s+time|handling\s+time|"
    r"bearbeitungszeit|bearbeitung\s+der\s+bestellung|"
    r"versand\s+innerhalb|wir\s+versenden\s+innerhalb|"
    r"traitement\s+de\s+la\s+commande|temps\s+de\s+pr[eé]paration|"
    r"exp[eé]dition\s+sous|"
    r"vi\s+packar|packas\s+inom|skickas\s+inom\s+\d|"
    r"vi\s+pakker|afsendes\s+inden|"
    # Swedish/Danish processing (added from real stores)
    r"handl[äa]ggningstid\w*|behandlings?tid\w*|att\s+bearbeta|bearbeta\s+\w*\s*best|"
    r"f[öo]rbereder|f[öo]rbereda|forbereder"
    r")",
    re.IGNORECASE,
)

DELIVERY_TRIGGER_RE = re.compile(
    r"(?:gemiddelde\s+levertijd|leveringstijd|levertijd|"
    r"delivery\s+time|shipping\s+time|estimated\s+delivery|delivery\s+takes|"
    r"average\s+delivery|transit\s+time|arrives?\s+(?:in|within)|"
    r"delivery\s+(?:in|within)|ships?\s+in|ber[äa]knad\s+leverans|standardleverans|"
    r"leveranstid|leveringstid|fragttid|lieferzeit|"
    r"delai\s+de\s+livraison|d[eé]lai\s+de\s+livraison|"
    r"durchschnittliche\s+lieferzeit)",
    re.IGNORECASE,
)


def _get_domain(product_url: str) -> str:
    if not product_url:
        return ""
    return urlparse(product_url).netloc.lower()


# ── Fetching (kept from the original) ──
def _discover_shipping_urls(domain: str) -> list:
    """Discover non-standard shipping pages via sitemap + homepage links."""
    discovered = []
    for sm in ("/sitemap.xml", "/sitemap_pages_1.xml", "/pages-sitemap.xml"):
        try:
            r = requests.get(f"https://{domain}{sm}", headers={"User-Agent": _UA}, timeout=6)
        except Exception:
            continue
        if r.status_code != 200:
            continue
        for m in re.finditer(r"<loc>([^<]+)</loc>", r.text):
            url = m.group(1); low = url.lower()
            if any(h in low for h in _URL_SHIPPING_HINTS) and ("/pages/" in low or "/policies/" in low):
                discovered.append(url)
    try:
        r = requests.get(f"https://{domain}/", headers={"User-Agent": _UA}, timeout=8)
        if r.status_code == 200:
            for m in re.finditer(r'href="([^"]+)"', r.text):
                href = m.group(1); low = href.lower()
                if any(h in low for h in _URL_SHIPPING_HINTS) and ("/pages/" in low or "/policies/" in low):
                    if href.startswith("/"):
                        href = f"https://{domain}{href}"
                    elif not href.startswith("http"):
                        continue
                    discovered.append(href)
    except Exception:
        pass
    seen, unique = set(), []
    for u in discovered:
        if u not in seen:
            seen.add(u); unique.append(u)
    return unique[:10]


def _fetch_html(url: str) -> str:
    """Raw HTML (for JSON-LD + text). '' on failure."""
    try:
        r = requests.get(url, headers={"User-Agent": _UA}, timeout=8, allow_redirects=True)
    except Exception:
        return ""
    if r.status_code != 200 or len(r.text) < 300:
        return ""
    return r.text


def _html_to_text(html: str) -> str:
    plain = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.I | re.S)
    plain = re.sub(r"<[^>]+>", " ", plain)
    return re.sub(r"\s+", " ", plain).lower()


def _fetch_policy_text_via_browser(domain: str) -> str:
    """Fallback for JS-rendered policy pages. Uses Playwright if available."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return ""
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                ctx = browser.new_context(user_agent=_UA, viewport={"width": 1280, "height": 900})
                page = ctx.new_page()
                for path in POLICY_PATHS:
                    url = f"https://{domain}{path}"
                    try:
                        page.goto(url, wait_until="domcontentloaded", timeout=12000)
                        page.wait_for_timeout(1500)
                        body_text = page.inner_text("body")
                    except Exception:
                        continue
                    if not body_text:
                        continue
                    plain = re.sub(r"\s+", " ", body_text).lower()
                    if any(w in plain for w in _SHIPPING_WORDS):
                        return plain
            finally:
                browser.close()
    except Exception:
        pass
    return ""


# ── JSON-LD shippingDetails (idea 2) ──
def _walk(o, _depth=0):
    if _depth > 40:   # JSON-LD shippingDetails is shallow; cap to avoid RecursionError on hostile/bloated data
        return
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from _walk(v, _depth + 1)
    elif isinstance(o, list):
        for v in o:
            yield from _walk(v, _depth + 1)


def _qv_days(q) -> tuple:
    """Schema.org QuantitativeValue -> (lo, hi) days, or None."""
    if not isinstance(q, dict):
        return None
    mn, mx, val = q.get("minValue"), q.get("maxValue"), q.get("value")
    try:
        lo = int(float(mn if mn is not None else (val if val is not None else mx)))
        hi = int(float(mx if mx is not None else (val if val is not None else mn)))
    except (TypeError, ValueError):
        return None
    unit = str(q.get("unitCode") or "DAY").upper()
    if unit in ("WEE", "WK", "WEEK"):
        lo, hi = lo * 7, hi * 7
    elif unit in ("HUR", "H", "HOUR"):
        lo, hi = max(1, round(lo / 24)), max(1, round(hi / 24))
    return tuple(sorted((lo, hi)))


def _jsonld_shipping_days(html: str) -> tuple:
    """Find handlingTime + transitTime in any JSON-LD shippingDetails. -> (lo,hi) or None."""
    best = None
    for m in re.finditer(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.I | re.S):
        raw = m.group(1).strip()
        try:
            data = _json.loads(raw)
            for node in _walk(data):
                if not isinstance(node, dict):
                    continue
                ht = _qv_days(node.get("handlingTime"))
                tt = _qv_days(node.get("transitTime"))
                dt = node.get("deliveryTime")
                if isinstance(dt, dict):
                    ht = ht or _qv_days(dt.get("handlingTime"))
                    tt = tt or _qv_days(dt.get("transitTime"))
                # Require transitTime: handlingTime alone is just processing, not the
                # total delivery — trusting it would mislabel a dropshipper as own-stock.
                if tt:
                    lo = (ht[0] if ht else 0) + tt[0]
                    hi = (ht[1] if ht else 0) + tt[1]
                    if hi > 0 and (best is None or hi > best[1]):
                        best = (lo, hi)
        except Exception:
            continue
    return best


# ── Regex parsing (idea 1+4) ──
def _find_range_near_trigger(text: str, trigger_re: re.Pattern, window: int = 170) -> tuple:
    """First duration right after each trigger; across triggers take the largest range.
    Used for the PROCESSING side (the first/closest number after the trigger is the
    right one there)."""
    best_lo, best_hi = 0, 0
    for trig in trigger_re.finditer(text):
        seg = text[trig.start(): trig.end() + window]
        m = _DUR_RE.search(seg)
        if not m:
            continue
        lo, hi = _dur_days(m)
        if not (1 <= lo <= 90 and 1 <= hi <= 90):
            continue
        if hi > best_hi:
            best_lo, best_hi = lo, hi
    return best_lo, best_hi


def _find_delivery_range(text: str, window: int = 350) -> tuple:
    """Delivery side: scan a WIDE window after each delivery trigger, look at ALL
    durations, skip any sitting in a processing- or return-context (±80 chars),
    and take the LARGEST remaining range. Fixes section-header policies where the
    first number after "leveranstid" is actually the processing time."""
    best_lo, best_hi = 0, 0
    for trig in DELIVERY_TRIGGER_RE.finditer(text):
        seg = text[trig.start(): trig.end() + window]
        for m in _DUR_RE.finditer(seg):
            ls = max(0, m.start() - 80); le = m.end() + 80
            local_ctx = seg[ls:le]
            if any(n in local_ctx for n in _RETURN_NEG):
                continue
            if any(p in local_ctx for p in _PROC_CONTEXT_WORDS):
                continue
            lo, hi = _dur_days(m)
            if not (1 <= lo <= 90 and 1 <= hi <= 90):
                continue
            if hi > best_hi:
                best_lo, best_hi = lo, hi
    return best_lo, best_hi


def _scan_all_durations(text: str) -> tuple:
    """Whole-text scan for durations in a shipping context, excluding return windows."""
    best_lo, best_hi = 0, 0
    for m in _DUR_RE.finditer(text):
        s = max(0, m.start() - 220); e = m.end() + 220
        ctx = text[s:e]
        if not any(w in ctx for w in SHIPPING_CONTEXT_NEAR):
            continue
        if any(n in ctx for n in _RETURN_NEG):
            continue
        lo, hi = _dur_days(m)
        if not (1 <= lo <= 90 and 1 <= hi <= 90):
            continue
        if hi > best_hi:
            best_lo, best_hi = lo, hi
    return best_lo, best_hi


def _parse_shipping(text: str) -> dict:
    """Regex classify. -> {label, lo, hi, confidence, borderline}."""
    if not text:
        return {"label": "Onbekend", "lo": 0, "hi": 0, "confidence": "none", "borderline": False}
    text = text.lower()  # context/return-word checks are plain substring matches

    proc = _find_range_near_trigger(text, PROCESSING_TRIGGER_RE)
    deliv = _find_delivery_range(text)

    if deliv[1] > 0:
        # Add processing on top of delivery — UNLESS proc is the exact same span as
        # delivery (same number matched by both a proc and a delivery trigger), which
        # would double-count it (e.g. "levertijd 3-5 … verzonden binnen 3-5").
        add_proc = proc[1] > 0 and proc != deliv
        lo = (proc[0] if add_proc else 0) + deliv[0]
        hi = (proc[1] if add_proc else 0) + deliv[1]
        confidence = "high"
    else:
        scan = _scan_all_durations(text)
        if scan[1] == 0:
            return {"label": "Onbekend", "lo": 0, "hi": 0, "confidence": "none", "borderline": False}
        # anti-double-count: scan just re-found the processing span, no real delivery
        if proc[1] > 0 and scan == proc:
            return {"label": "Onbekend", "lo": 0, "hi": 0, "confidence": "none", "borderline": False}
        lo = scan[0] + proc[0]
        hi = scan[1] + proc[1]
        confidence = "medium"

    label = "Dropshipper" if hi >= 5 else "Eigen voorraad"
    borderline = 4 <= hi <= 6
    return {"label": label, "lo": lo, "hi": hi, "confidence": confidence, "borderline": borderline}


def _parse_label_string(s: str) -> dict:
    """Parse an LLM/vision 'Dropshipper (X-Yd)' reply -> dict or None."""
    if not s:
        return None
    s = s.strip()
    if s.startswith("Onbekend"):
        return {"label": "Onbekend", "lo": 0, "hi": 0}
    label = "Dropshipper" if s.startswith("Dropshipper") else ("Eigen voorraad" if s.startswith("Eigen voorraad") else None)
    if not label:
        return None
    m = re.search(r"(\d+)\s*-\s*(\d+)", s)
    if m:
        lo, hi = int(m.group(1)), int(m.group(2))
    else:
        m2 = re.search(r"(\d+)", s)
        lo = hi = int(m2.group(1)) if m2 else 0
    return {"label": label, "lo": lo, "hi": hi}


# ── LLM (idea 3: few-shot + model-selectable) ──
def _classify_via_llm(text: str, domain: str, model: str = "claude-haiku-4-5") -> dict:
    """Ask Claude to extract total delivery days from messy policy text. -> dict or None."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    try:
        import anthropic
    except Exception:
        return None

    if len(text) > 9000:
        idx = -1
        for kw in ("verzend", "shipping", "delivery", "levering", "lieferzeit",
                   "fragt", "leverans", "livraison", "verzendtijd", "leveringstid"):
            i = text.find(kw)
            if i != -1:
                idx = i; break
        text = text[max(0, idx - 500): idx + 6000] if idx >= 0 else text[:7000]

    prompt = (
        "Read text from a webshop's shipping/delivery policy and determine the TOTAL number "
        "of days from order placement to arrival, INCLUDING any separate order-processing / "
        "handling time. Convert weeks to days (1 week = 7 days) and hours to days. IGNORE "
        "return/refund/warranty windows.\n\n"
        "Examples:\n"
        "  'Verwerkingstijd 1-2 dagen. Levertijd 3-5 werkdagen.' -> Dropshipper (4-7d)\n"
        "  'Levering binnen 2-4 weken' -> Dropshipper (14-28d)\n"
        "  'Order ships within 24-48 hours' -> Eigen voorraad (1-2d)\n"
        "  'Bezorging de volgende werkdag' -> Eigen voorraad (1-1d)\n"
        "  'Je kunt binnen 30 dagen retourneren' (only a return window) -> Onbekend\n\n"
        f"Domain: {domain}\nPolicy text:\n---\n{text}\n---\n\n"
        "Reply on ONE line with EXACTLY one of:\n"
        "  Dropshipper (X-Yd)        -- total delivery time is 5 or more days\n"
        "  Eigen voorraad (X-Yd)     -- total delivery time is less than 5 days\n"
        "  Onbekend                  -- no clear delivery time\n"
        "X = min, Y = max whole days. Example: 'Dropshipper (7-14d)'."
    )
    try:
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model=model, max_tokens=60,
            messages=[{"role": "user", "content": prompt}],
        )
        return _parse_label_string((msg.content[0].text or "").strip())
    except Exception as e:
        print(f"  ! LLM error ({model}) for {domain}: {e}")
        return None


# ── Vision + ad-copy (kept; used only in full mode / WinningHunter) ──
def _fetch_screenshot(domain: str) -> bytes:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return b""
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                ctx = browser.new_context(viewport={"width": 1280, "height": 1800}, user_agent=_UA)
                page = ctx.new_page()
                for path in ("/policies/shipping-policy", "/pages/verzending", "/pages/shipping",
                             "/pages/verzendbeleid", "/policies/refund-policy"):
                    url = f"https://{domain}{path}"
                    try:
                        r = page.goto(url, wait_until="domcontentloaded", timeout=12000)
                        if r and r.status >= 400:
                            continue
                        page.wait_for_timeout(2000)
                        return page.screenshot(full_page=True)
                    except Exception:
                        continue
            finally:
                browser.close()
    except Exception:
        pass
    return b""


def _classify_via_vision(domain: str) -> str:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return ""
    try:
        import anthropic, base64
    except Exception:
        return ""
    img = _fetch_screenshot(domain)
    if not img or len(img) < 5000:
        return ""
    img_b64 = base64.standard_b64encode(img).decode()
    prompt = (
        "Screenshot of a webshop's policy/shipping page. Determine TOTAL days from order to "
        "arrival, INCLUDING processing time (convert weeks->days).\n"
        "Respond on ONE line: 'Dropshipper (X-Yd)' (total >=5), 'Eigen voorraad (X-Yd)' (<5), "
        "or 'Onbekend'."
    )
    try:
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-haiku-4-5", max_tokens=60,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": img_b64}},
                {"type": "text", "text": prompt},
            ]}],
        )
        reply = (msg.content[0].text or "").strip().splitlines()[0] if msg.content else ""
        parsed = _parse_label_string(reply)
        return reply if parsed else ""
    except Exception as e:
        print(f"  ! Vision LLM error for {domain}: {e}")
    return ""


def _classify_via_ad_copy(ad_copy: str, store_name: str, product_title: str) -> str:
    if not ad_copy or len(ad_copy.strip()) < 30:
        return ""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return ""
    try:
        import anthropic
    except Exception:
        return ""
    prompt = (
        f"Facebook ad copy from store '{store_name}' for product '{product_title}'.\n\n"
        f"Ad copy:\n---\n{ad_copy[:1500]}\n---\n\n"
        "Based ONLY on what the ad says about shipping/delivery, decide:\n"
        "  Dropshipper (X-Yd)     -- long delivery (>=5 days) or phrases like 'ships in 7-14 days'\n"
        "  Eigen voorraad (X-Yd)  -- explicitly fast/local/next-day shipping\n"
        "  Onbekend               -- nothing about shipping\n"
        "Respond on ONE line. Example: 'Dropshipper (7-14d)' or 'Onbekend'."
    )
    try:
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(model="claude-haiku-4-5", max_tokens=50,
                                     messages=[{"role": "user", "content": prompt}])
        reply = (msg.content[0].text or "").strip()
        return reply if _parse_label_string(reply) else ""
    except Exception as e:
        print(f"  ! Ad-copy LLM error: {e}")
    return ""


# ── Orchestration ──
def _res(label, lo, hi, source, confidence) -> dict:
    return {"label": label, "lo": lo, "hi": hi,
            "detail": (f"{lo}-{hi}d" if hi > 0 else ""),
            "source": source, "confidence": confidence}


def _maybe_llm_verify(p: dict, text: str, domain: str, source: str) -> dict:
    """Trust confident, non-borderline regex. Otherwise corroborate with Haiku;
    on disagreement escalate to a Sonnet tiebreaker (idea 3b + 5)."""
    res = _res(p["label"], p["lo"], p["hi"], source, p["confidence"])
    if not (p.get("borderline") or p["confidence"] in ("low", "medium")):
        return res
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return res
    llm = _classify_via_llm(text, domain)
    if not llm or llm["label"] == "Onbekend":
        return res
    if llm["label"] == p["label"]:
        return _res(p["label"], p["lo"], p["hi"], source, "high")  # corroborated
    son = _classify_via_llm(text, domain, model="claude-sonnet-4-5")
    if son and son["label"] != "Onbekend":
        return _res(son["label"], son["lo"], son["hi"], "llm-sonnet", "high")
    return _res(p["label"], p["lo"], p["hi"], source, "low")


# ── Brand signals: is this a real BRAND/boutique rather than a dropshipper? ──
# Slow international shipping makes real brands (Billy J, MESHKI) look like
# dropshippers to the day-count classifier. These signals catch that: hrefs to
# store-locator / stockists / wholesale pages are near-certain brand markers;
# text markers are noisier and need two hits.
_BRAND_LINK_SIGNALS = (
    ("store-locator", "store locator"), ("storelocator", "store locator"),
    ("find-a-store", "store locator"), ("our-stores", "own stores"),
    ("stockist", "stockists page"), ("winkels", "own stores"),
    ("butikker", "own stores"), ("wholesale", "wholesale program"),
    ("/b2b", "wholesale/B2B"), ("become-a-retailer", "wholesale program"),
)
_BRAND_TEXT_SIGNALS = (
    (r"design(?:ed)?\s+in[\-\s]?house|our design team|eigen ontwerp|our atelier", "in-house designs"),
    (r"visit (?:one of )?our stores?|in onze winkel", "own stores"),
    (r"become a (?:stockist|retailer)|wholesale (?:portal|inquir|application)", "wholesale program"),
    (r"as seen in|featured in", "press features"),
    (r"founded in (?:19|20)\d\d|est\.?\s?(?:19|20)\d\d|opgericht in (?:19|20)\d\d", "established year"),
)


def brand_signals(domain: str) -> list:
    """Signals that `domain` is a real brand/boutique. Returns labels (possibly
    empty). Cached per domain; homepage-only, best-effort, never raises."""
    key = f"B|{domain}"
    if key in _CACHE:
        return _CACHE[key]
    sigs = []
    try:
        html = _fetch_html(f"https://{domain}/") or ""
        low = html.lower()
        if low:
            hrefs = " ".join(re.findall(r'href="([^"]{1,200})"', low))
            for hint, label in _BRAND_LINK_SIGNALS:
                if hint in hrefs and label not in sigs:
                    sigs.append(label)
            for pat, label in _BRAND_TEXT_SIGNALS:
                if label not in sigs and re.search(pat, low):
                    sigs.append(label)
    except Exception:
        pass
    _CACHE[key] = sigs
    return sigs


_BRAND_ABOUT_PATHS = ("/pages/about-us", "/pages/about", "/pages/our-story", "/pages/over-ons")


def _brand_llm_verdict(domain: str, evidence: list) -> tuple:
    """Claude reads the store's own homepage/about copy and judges: real brand/
    boutique vs dropshipping store. Returns (True/False/None, reason). The text
    heuristics alone miss exactly the Billy J/MESHKI class, so this is the
    decisive layer. Only called when the shipping classifier said 'Dropshipper'
    (i.e. at most once per new source domain; cached by the caller)."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None, ""
    text = _html_to_text(_fetch_html(f"https://{domain}/") or "")[:5000]
    for path in _BRAND_ABOUT_PATHS:
        about = _fetch_html(f"https://{domain}{path}")
        if about and len(about) > 2000:
            text += "\n\n[ABOUT PAGE]\n" + _html_to_text(about)[:3000]
            break
    if len(text) < 300:
        return None, ""
    try:
        import anthropic, json as _json
        client = anthropic.Anthropic(api_key=api_key)
        prompt = (
            "You are auditing a fashion webshop for a dropshipping business that must ONLY source from "
            "other dropshippers, never from real brands/boutiques (importing a real brand's products has "
            "caused expensive cleanups: Billy J, MESHKI).\n\n"
            "Classify this store as:\n"
            "A) REAL BRAND / BOUTIQUE - designs or manufactures its own products, or is an established "
            "label/boutique: own design studio or atelier, physical stores or stockists, wholesale "
            "program, genuine brand story/history, press features, consistent eponymous branding.\n"
            "B) DROPSHIPPING STORE - generic products shipped by third-party suppliers: vague or absent "
            "brand story, template text, discount pop-ups, wide unrelated assortment, long overseas "
            "shipping, recently renamed/generic boutique-sounding name with no substance behind it.\n\n"
            f"Store domain: {domain}\n"
            f"Automated signals found: {', '.join(evidence) or 'none'}\n\n"
            "STORE'S OWN TEXT (homepage + about):\n" + text +
            "\n\nRespond ONLY with JSON: {\"is_brand\": true|false, \"confidence\": \"high\"|\"low\", "
            "\"reason\": \"<max 15 words>\"}. If genuinely unsure, use confidence low."
        )
        msg = client.messages.create(model="claude-haiku-4-5-20251001", max_tokens=150,
                                     messages=[{"role": "user", "content": prompt}])
        raw = (msg.content[0].text if msg.content else "") or ""
        m = re.search(r"\{.*\}", raw, re.S)
        if not m:
            return None, ""
        d = _json.loads(m.group(0))
        is_brand = bool(d.get("is_brand"))
        if d.get("confidence") == "low" and not is_brand:
            return None, ""
        return is_brand, str(d.get("reason") or "")[:120]
    except Exception as e:
        print(f"[brand] llm verdict failed for {domain}: {e}")
        return None, ""


def looks_like_brand(domain: str) -> tuple:
    """(True, reasons) when the store looks like a real BRAND/boutique rather
    than a dropshipper. Layered: cheap link signals (store locator / stockists /
    wholesale hrefs) decide instantly; otherwise Claude judges the store's own
    homepage/about copy. Result cached per domain."""
    key = f"BB|{domain}"
    if key in _CACHE:
        return _CACHE[key]
    sigs = brand_signals(domain)
    link_labels = {"store locator", "own stores", "stockists page", "wholesale program", "wholesale/B2B"}
    if any(s in link_labels for s in sigs):
        res = (True, sigs)
    else:
        verdict, reason = _brand_llm_verdict(domain, sigs)
        if verdict is True:
            res = (True, sigs + ([f"AI: {reason}"] if reason else ["AI judged this a real brand"]))
        else:
            res = (False, sigs)
    _CACHE[key] = res
    return res


def classify_detailed(product_url: str, skip_browser: bool = True) -> dict:
    """Full structured classification. -> {label, lo, hi, detail, source, confidence}."""
    domain = _get_domain(product_url)
    if not domain:
        return _res("Onbekend", 0, 0, "none", "none")
    cache_key = f"D|{domain}|{int(skip_browser)}"
    if cache_key in _CACHE:
        return _CACHE[cache_key]
    res = _classify_detailed(domain, product_url, skip_browser)
    _CACHE[cache_key] = res
    return res


def _classify_detailed(domain: str, product_url: str, skip_browser: bool) -> dict:
    collected = ""
    # Policy pages first (authoritative on delivery time); the product page — whose
    # marketing copy can contradict the policy fine print — is the fallback. JSON-LD
    # on any page still wins when present.
    pages = [f"https://{domain}{p}" for p in POLICY_PATHS] + ([product_url] if product_url else [])
    for url in pages:
        html = _fetch_html(url)
        if not html:
            continue
        j = _jsonld_shipping_days(html)   # idea 2 — high precision
        if j and j[1] > 0:
            lo, hi = j
            return _res("Dropshipper" if hi >= 5 else "Eigen voorraad", lo, hi, "structured", "high")
        plain = _html_to_text(html)
        if not any(w in plain for w in _SHIPPING_WORDS):
            continue
        if not collected:
            collected = plain
        p = _parse_shipping(plain)
        if p["label"] != "Onbekend":
            return _maybe_llm_verify(p, plain, domain, "policy")

    for url in _discover_shipping_urls(domain):
        html = _fetch_html(url)
        if not html:
            continue
        j = _jsonld_shipping_days(html)
        if j and j[1] > 0:
            lo, hi = j
            return _res("Dropshipper" if hi >= 5 else "Eigen voorraad", lo, hi, "structured", "high")
        plain = _html_to_text(html)
        if not any(w in plain for w in _SHIPPING_WORDS):
            continue
        if not collected:
            collected = plain
        p = _parse_shipping(plain)
        if p["label"] != "Onbekend":
            return _maybe_llm_verify(p, plain, domain, "policy")

    if not skip_browser:
        t = _fetch_policy_text_via_browser(domain)
        if t:
            if not collected:
                collected = t
            p = _parse_shipping(t)
            if p["label"] != "Onbekend":
                return _maybe_llm_verify(p, t, domain, "policy-js")

    # LLM on whatever text we have (regex found nothing definitive)
    if collected:
        llm = _classify_via_llm(collected, domain)
        if llm and llm["label"] != "Onbekend":
            return _res(llm["label"], llm["lo"], llm["hi"], "llm", "medium")

    if not skip_browser:
        pv = _parse_label_string(_classify_via_vision(domain))
        if pv and pv["label"] != "Onbekend":
            return _res(pv["label"], pv["lo"], pv["hi"], "vision", "medium")

    return _res("Onbekend", 0, 0, "none", "none")


def check_shipping(product_url: str, skip_browser: bool = False) -> str:
    """Legacy string API: 'Dropshipper (X-Yd)' / 'Eigen voorraad (X-Yd)' / 'Onbekend' / ''."""
    if not _get_domain(product_url):
        return ""
    d = classify_detailed(product_url, skip_browser=skip_browser)
    if d["label"] == "Onbekend":
        return "Onbekend"
    return f"{d['label']} ({d['detail']})" if d["detail"] else d["label"]


def check_shipping_with_ad_copy(product_url: str, ad_copy: str, store_name: str, product_title: str) -> str:
    result = check_shipping(product_url)
    if result and result != "Onbekend":
        return result
    ad_result = _classify_via_ad_copy(ad_copy, store_name, product_title)
    if ad_result and _parse_label_string(ad_result) and not ad_result.startswith("Onbekend"):
        return ad_result
    return result or "Onbekend"


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    for u in (
        "https://vionna-clothing.dk/",
        "https://vionna-clothing.fr/",
    ):
        d = classify_detailed(u, skip_browser=True)
        print(f"{_get_domain(u):34} -> {d['label']} ({d['detail']}) [src={d['source']} conf={d['confidence']}]")
