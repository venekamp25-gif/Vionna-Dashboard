"""Check a Shopify store's shipping policy to classify as dropshipper or own-stock.

Strategy:
1. Try common policy URLs (Shopify default + custom pages)
2. Parse text for delivery-time ranges in NL/EN/DE/FR/SE/DA
3. If max range >= 5 days  -> 'Dropshipper'
   If max range  < 5 days  -> 'Eigen voorraad'
   If no range found       -> 'Onbekend'
"""
import os
import re
import sys
from urllib.parse import urlparse
import requests

_CACHE: dict[str, str] = {}
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
    # Extra paths
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

# Words that mark a section about delivery/shipping time
SHIPPING_CONTEXT_TERMS = (
    "leveranstid", "leveringstid", "verzendtijd", "shipping time", "delivery time",
    "fragttid", "lieferzeit", "delai de livraison", "délai de livraison",
    "levertijd", "leveringstijd", "verzendbeleid", "verzending nederland",
    "shipping & delivery", "shipping and delivery", "shipping policy",
)

# Within a shipping-context section we accept broader day terms
_GENERIC_DAY_TERMS = (
    r"werkdagen|werkdage|werktage|werktagen|"
    r"vardagar|arbetsdagar|"
    r"hverdage|hverdager|"
    r"jours\s*ouvr\w*|"
    r"business\s*days|"
    r"dagen|dagar|dage|tage|days"
)
DELIVERY_PATTERNS_SECTION = (
    rf"(\d{{1,2}})\s*[-–to/till bis]{{1,5}}\s*(\d{{1,2}})\s*(?:{_GENERIC_DAY_TERMS})",
)

_BUSINESS_DAY_TERMS = (
    r"werkdagen|werkdage|werktage|werktagen|"
    r"vardagar|arbetsdagar|"
    r"hverdage|hverdager|"
    r"jours\s*ouvr\w*|"
    r"business\s*days"
)
DELIVERY_PATTERNS = (
    rf"(\d{{1,2}})\s*[-–to/till bis]{{1,5}}\s*(\d{{1,2}})\s*(?:{_BUSINESS_DAY_TERMS})",
)

PROCESSING_TRIGGER_RE = re.compile(
    r"(?:"
    # Dutch
    r"verwerk\w*|verwerkings?tijd|"
    r"wij\s+verpakken|we\s+verpakken|verzenden\s+uw\s+bestelling|"
    r"verzonden\s+binnen|verzenden\s+binnen|"
    # English
    r"order\s+processing|processing\s+time|preparation\s+time|"
    r"we\s+pack|we\s+process|shipped?\s+out|shipping\s+out|"
    r"dispatched?\s+within|dispatch\s+time|"
    # German
    r"bearbeitungszeit|bearbeitung\s+der\s+bestellung|"
    r"versand\s+innerhalb|wir\s+versenden\s+innerhalb|"
    # French
    r"traitement\s+de\s+la\s+commande|temps\s+de\s+pr[eé]paration|"
    r"exp[eé]dition\s+sous|"
    # Swedish (avoid 'vi skickar' alone — ambiguous; require 'packar' or 'skickas inom')
    r"vi\s+packar|packas\s+inom|skickas\s+inom\s+\d|"
    # Danish
    r"vi\s+pakker|afsendes\s+inden"
    r")",
    re.IGNORECASE,
)

DELIVERY_TRIGGER_RE = re.compile(
    r"(?:gemiddelde\s+levertijd|leveringstijd|levertijd|"
    r"delivery\s+time|shipping\s+time|estimated\s+delivery|"
    r"average\s+delivery|transit\s+time|"
    r"leveranstid|leveringstid|fragttid|lieferzeit|"
    r"delai\s+de\s+livraison|d[eé]lai\s+de\s+livraison|"
    r"durchschnittliche\s+lieferzeit)",
    re.IGNORECASE,
)

# Single-or-range day count
_DAY_COUNT_PATTERN = rf"(\d{{1,2}})(?:\s*[-–to/till bis]{{1,5}}\s*(\d{{1,2}}))?\s*(?:{_BUSINESS_DAY_TERMS})"


def _get_domain(product_url: str) -> str:
    if not product_url:
        return ""
    parsed = urlparse(product_url)
    return parsed.netloc.lower()


def check_shipping(product_url: str, skip_browser: bool = False) -> str:
    """Returns: 'Dropshipper (X-Yd)', 'Eigen voorraad (X-Yd)', 'Onbekend', or ''.

    skip_browser=True skips the Playwright + vision layers (no headless Chromium) —
    used by the live dashboard import check where speed matters and Playwright
    isn't installed. Keeps HTTP paths + sitemap + product page + text-LLM."""
    domain = _get_domain(product_url)
    if not domain:
        return ""
    cache_key = f"{domain}|{int(skip_browser)}"
    if cache_key in _CACHE:
        return _CACHE[cache_key]
    result = _classify(domain, product_url, skip_browser=skip_browser)
    _CACHE[cache_key] = result
    return result


_SHIPPING_WORDS = ("verzend", "shipping", "delivery", "levering", "livraison",
                   "versand", "fragt", "leverans", "lieferzeit", "leveringstid")

_URL_SHIPPING_HINTS = ("shipping", "verzend", "deliver", "lever", "fragt", "leverans",
                       "livraison", "versand", "expedition", "expédition")


def _discover_shipping_urls(domain: str) -> list[str]:
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
            url = m.group(1)
            low = url.lower()
            if any(h in low for h in _URL_SHIPPING_HINTS) and ("/pages/" in low or "/policies/" in low):
                discovered.append(url)

    try:
        r = requests.get(f"https://{domain}/", headers={"User-Agent": _UA}, timeout=8)
        if r.status_code == 200:
            for m in re.finditer(r'href="([^"]+)"', r.text):
                href = m.group(1)
                low = href.lower()
                if any(h in low for h in _URL_SHIPPING_HINTS) and ("/pages/" in low or "/policies/" in low):
                    if href.startswith("/"):
                        href = f"https://{domain}{href}"
                    elif not href.startswith("http"):
                        continue
                    discovered.append(href)
    except Exception:
        pass

    seen = set()
    unique = []
    for u in discovered:
        if u not in seen:
            seen.add(u)
            unique.append(u)
    return unique[:10]


def _fetch_url_text(url: str) -> str:
    try:
        r = requests.get(url, headers={"User-Agent": _UA}, timeout=8, allow_redirects=True)
    except Exception:
        return ""
    if r.status_code != 200 or len(r.text) < 500:
        return ""
    plain = re.sub(r"<[^>]+>", " ", r.text)
    plain = re.sub(r"\s+", " ", plain).lower()
    if any(w in plain for w in _SHIPPING_WORDS):
        return plain
    return ""


def _fetch_policy_text(domain: str) -> str:
    for path in POLICY_PATHS:
        url = f"https://{domain}{path}"
        try:
            r = requests.get(url, headers={"User-Agent": _UA}, timeout=8, allow_redirects=True)
        except Exception:
            continue
        if r.status_code != 200 or len(r.text) < 500:
            continue
        plain = re.sub(r"<[^>]+>", " ", r.text)
        plain = re.sub(r"\s+", " ", plain).lower()
        if any(w in plain for w in _SHIPPING_WORDS):
            return plain
    return ""


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


SHIPPING_CONTEXT_NEAR = (
    "shipping", "delivery", "verzend", "levering", "leveranstid", "leveringstid",
    "fragt", "frakt", "leverans", "lieferzeit", "livraison", "versand",
    "verzendtijd", "levertijd", "verzendbeleid",
)


def _classify(domain: str, product_url: str = "", skip_browser: bool = False) -> str:
    collected_text = ""

    # 1) Standard Shopify policy paths via requests
    text = _fetch_policy_text(domain)
    if text:
        collected_text = text
        result = _classify_text(text)
        if result != "Onbekend":
            return result

    # 2) Sitemap / homepage-discovered custom paths
    for url in _discover_shipping_urls(domain):
        t = _fetch_url_text(url)
        if t:
            collected_text = collected_text or t
            r = _classify_text(t)
            if r != "Onbekend":
                return r

    # 3) Product page itself often embeds shipping info in description
    if product_url:
        t = _fetch_url_text(product_url)
        if t:
            collected_text = collected_text or t
            r = _classify_text(t)
            if r != "Onbekend":
                return r

    # 4) Render with Playwright (catches JS-only policies) — skipped in fast mode
    if not skip_browser:
        text2 = _fetch_policy_text_via_browser(domain)
        if text2:
            collected_text = collected_text or text2
            result = _classify_text(text2)
            if result != "Onbekend":
                return result

    # 5) LLM extraction on whatever text we have
    if collected_text:
        llm_result = _classify_via_llm(collected_text, domain)
        if llm_result and llm_result != "Onbekend":
            return llm_result

    # 6) Vision LLM — screenshot the policy page and let Claude read the image — skipped in fast mode
    if not skip_browser:
        vision_result = _classify_via_vision(domain)
        if vision_result and vision_result != "Onbekend":
            return vision_result

    return "Onbekend"


def check_shipping_with_ad_copy(product_url: str, ad_copy: str, store_name: str, product_title: str) -> str:
    """Run normal shipping check; if Onbekend, fall back to ad-copy LLM analysis."""
    result = check_shipping(product_url)
    if result and result != "Onbekend":
        return result
    ad_result = _classify_via_ad_copy(ad_copy, store_name, product_title)
    if ad_result and ad_result != "Onbekend":
        return ad_result
    return result or "Onbekend"


def _fetch_screenshot(domain: str) -> bytes:
    """Take a Playwright screenshot of the most likely policy page."""
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
    """Last-ditch: screenshot the policy page and let Claude vision read it."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return ""
    try:
        import anthropic
        import base64
    except Exception:
        return ""

    img = _fetch_screenshot(domain)
    if not img or len(img) < 5000:
        return ""

    img_b64 = base64.standard_b64encode(img).decode()
    prompt = (
        "Screenshot of an e-commerce store's policy/shipping page. "
        "Determine TOTAL business days from order to arrival, INCLUDING any processing time.\n\n"
        "Respond on ONE line with EXACTLY one of:\n"
        "  Dropshipper (X-Yd)        -- total delivery >= 5 business days\n"
        "  Eigen voorraad (X-Yd)     -- total delivery < 5 business days\n"
        "  Onbekend                  -- no delivery info visible\n\n"
        "Example: 'Dropshipper (7-14d)'."
    )
    try:
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=60,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": img_b64}},
                {"type": "text", "text": prompt},
            ]}],
        )
        reply = (msg.content[0].text or "").strip()
        for prefix in ("Dropshipper", "Eigen voorraad"):
            if reply.startswith(prefix) and "(" in reply and "d)" in reply:
                return reply.splitlines()[0].strip()
        if reply.startswith("Onbekend"):
            return "Onbekend"
    except Exception as e:
        print(f"  ! Vision LLM error for {domain}: {e}")
    return ""


def _classify_via_ad_copy(ad_copy: str, store_name: str, product_title: str) -> str:
    """Analyze the Facebook ad copy itself — dropshippers often telegraph long delivery times."""
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
        "Based ONLY on what the ad says about shipping/delivery (if anything), decide:\n"
        "  Dropshipper (X-Yd)     -- ad mentions long delivery (>= 5 business days), OR\n"
        "                            uses dropshipper-classic phrases like 'ships in 7-14 days', 'limited time worldwide shipping', 'order today, arrives in X weeks'\n"
        "  Eigen voorraad (X-Yd)  -- ad explicitly mentions fast/local/next-day shipping\n"
        "  Onbekend               -- ad says nothing about shipping/delivery\n\n"
        "Respond on ONE line, EXACT format. Example: 'Dropshipper (7-14d)' or 'Onbekend'."
    )
    try:
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=50,
            messages=[{"role": "user", "content": prompt}],
        )
        reply = (msg.content[0].text or "").strip()
        for prefix in ("Dropshipper", "Eigen voorraad"):
            if reply.startswith(prefix) and "(" in reply and "d)" in reply:
                return reply.splitlines()[0].strip()
        if reply.startswith("Onbekend"):
            return "Onbekend"
    except Exception as e:
        print(f"  ! Ad-copy LLM error: {e}")
    return ""


def _classify_via_llm(text: str, domain: str) -> str:
    """Ask Claude to extract total delivery time from messy policy text."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return ""
    try:
        import anthropic
    except Exception:
        return ""

    if len(text) > 9000:
        idx = -1
        for kw in ("verzend", "shipping", "delivery", "levering", "lieferzeit",
                   "fragt", "leverans", "livraison", "verzendtijd", "leveringstid"):
            i = text.find(kw)
            if i != -1:
                idx = i
                break
        if idx >= 0:
            text = text[max(0, idx - 500): idx + 6000]
        else:
            text = text[:7000]

    prompt = (
        "You will read text from an e-commerce store's shipping/delivery policy and decide the "
        "TOTAL number of business days between order placement and arrival, INCLUDING any "
        "order processing/handling time mentioned separately.\n\n"
        f"Domain: {domain}\n\n"
        "Policy text:\n---\n"
        f"{text}\n---\n\n"
        "Respond on ONE line with EXACTLY one of these formats:\n"
        "  Dropshipper (X-Yd)        -- if total delivery time is 5 or more business days\n"
        "  Eigen voorraad (X-Yd)     -- if total delivery time is less than 5 business days\n"
        "  Onbekend                  -- if no clear delivery time mentioned\n\n"
        "X = min days, Y = max days (whole numbers). Example: 'Dropshipper (7-14d)'."
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=60,
            messages=[{"role": "user", "content": prompt}],
        )
        reply = (msg.content[0].text or "").strip()
        for prefix in ("Dropshipper", "Eigen voorraad"):
            if reply.startswith(prefix) and "(" in reply and "d)" in reply:
                return reply.splitlines()[0].strip()
        if reply.startswith("Onbekend"):
            return "Onbekend"
    except Exception as e:
        print(f"  ! LLM error for {domain}: {e}")
    return ""


def _classify_text(text: str) -> str:
    if not text:
        return "Onbekend"

    # Preferred path: explicit processing window + explicit delivery window.
    proc_lo, proc_hi = _find_processing_range(text)
    deliv_lo, deliv_hi = _find_delivery_range(text)

    # If we got at least a delivery section, use proc+delivery.
    if deliv_hi > 0:
        total_lo = (proc_lo if proc_hi > 0 else 0) + deliv_lo
        total_hi = (proc_hi if proc_hi > 0 else 0) + deliv_hi
        label = "Dropshipper" if total_hi >= 5 else "Eigen voorraad"
        return f"{label} ({total_lo}-{total_hi}d)"

    # Fallback: scan whole text for business-day ranges (works when there's only one).
    deliv_lo, deliv_max = _scan_ranges(text, DELIVERY_PATTERNS)
    if deliv_max == 0:
        for pat in DELIVERY_PATTERNS_SECTION:
            for m in re.finditer(pat, text, re.IGNORECASE):
                start = max(0, m.start() - 250)
                end = m.end() + 250
                context = text[start:end].lower()
                if not any(w in context for w in SHIPPING_CONTEXT_NEAR):
                    continue
                if any(neg in context for neg in ("retour", "return", "refund", "garantie", "garantee", "warranty", "tilbagebetaling")):
                    continue
                try:
                    lo = int(m.group(1))
                    hi_str = m.group(2) if m.lastindex and m.lastindex >= 2 else None
                    hi = int(hi_str) if hi_str else lo
                    if 1 <= lo <= 60 and 1 <= hi <= 60:
                        lo, hi = sorted([lo, hi])
                        if hi > deliv_max:
                            deliv_max, deliv_lo = hi, lo
                except (ValueError, IndexError):
                    continue
    if deliv_max == 0:
        return "Onbekend"

    # In fallback, if processing was found via trigger, add it on top.
    total_lo = deliv_lo + proc_lo
    total_hi = deliv_max + proc_hi
    label = "Dropshipper" if total_hi >= 5 else "Eigen voorraad"
    return f"{label} ({total_lo}-{total_hi}d)"


def _find_range_near_trigger(text: str, trigger_re: re.Pattern, window: int = 150) -> tuple[int, int]:
    """For each trigger, take the FIRST day count right after it (closest);
    across multiple triggers take the largest range. Avoids picking up unrelated numbers later in the text."""
    best_lo, best_hi = 0, 0
    for trig in trigger_re.finditer(text):
        section = text[trig.start(): trig.end() + window]
        m = re.search(_DAY_COUNT_PATTERN, section, re.IGNORECASE)
        if not m:
            continue
        try:
            lo = int(m.group(1))
            hi_str = m.group(2)
            hi = int(hi_str) if hi_str else lo
            if not (1 <= lo <= 60 and 1 <= hi <= 60):
                continue
            lo, hi = sorted([lo, hi])
            if hi > best_hi:
                best_lo, best_hi = lo, hi
        except (ValueError, IndexError):
            continue
    return best_lo, best_hi


def _find_processing_range(text: str) -> tuple[int, int]:
    return _find_range_near_trigger(text, PROCESSING_TRIGGER_RE)


def _find_delivery_range(text: str) -> tuple[int, int]:
    return _find_range_near_trigger(text, DELIVERY_TRIGGER_RE)


def _scan_ranges(text: str, patterns: tuple) -> tuple[int, int]:
    best_lo, best_max = 0, 0
    for pat in patterns:
        for m in re.finditer(pat, text, re.IGNORECASE):
            try:
                lo = int(m.group(1))
                hi_str = m.group(2) if m.lastindex and m.lastindex >= 2 else None
                hi = int(hi_str) if hi_str else lo
                if not (1 <= lo <= 60 and 1 <= hi <= 60):
                    continue
                lo, hi = sorted([lo, hi])
                if hi > best_max:
                    best_max, best_lo = hi, lo
            except (ValueError, IndexError):
                continue
    return best_lo, best_max


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    test_urls = [
        "https://www.belysningsproffsen.se/products/solcellsdriven-utomhuslampa",
        "https://www.florabel.se/products/floratulip-led-light",
        "https://www.ristal.se/products/lysdroppe",
        "https://lumiere-design.de/products/fadio",
        "https://www.monah.shop/products/lampe",
        "https://laluna.amsterdam/products/dames-shorts",
    ]
    for u in test_urls:
        result = check_shipping(u)
        domain = _get_domain(u)
        s = f"{domain:40} -> {result}".encode("ascii", "replace").decode("ascii")
        print(s)
