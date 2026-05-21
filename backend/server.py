import os, sys, json, re, hashlib, urllib.parse, subprocess, tempfile, shutil, platform, unicodedata
from flask import Flask, request, redirect, session, jsonify, send_from_directory
from flask_cors import CORS
import requests as req
from dotenv import load_dotenv

# Fix encoding on Windows (prevents UnicodeEncodeError for special chars in print)
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'), override=True)

app = Flask(__name__, static_folder='.')
app.secret_key = os.environ.get('SECRET_KEY') or os.urandom(24)

# CORS: allow Next.js frontend (localhost:3000 in dev, vercel.app domain in prod).
# Routes under /api/* will accept cross-origin requests from these origins.
_allowed_origins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    os.environ.get('FRONTEND_URL', ''),
]
CORS(app, resources={r'/api/*': {'origins': [o for o in _allowed_origins if o]}}, supports_credentials=True)

@app.errorhandler(Exception)
def handle_error(e):
    return jsonify({'error': str(e)}), 500

ANTHROPIC_KEY  = os.getenv('ANTHROPIC_API_KEY')

# Cross-platform Higgsfield CLI lookup (works on Windows + Linux droplet).
IS_WINDOWS = platform.system() == 'Windows'

def _find_higgsfield_exe():
    """Locate the Higgsfield CLI binary on Windows or Linux."""
    # Allow override via env var (useful for deployment)
    override = os.environ.get('HIGGSFIELD_BIN')
    if override and os.path.isfile(override):
        return override

    if IS_WINDOWS:
        home    = os.path.expanduser('~')
        npm_dir = os.path.join(home, 'AppData', 'Roaming', 'npm')
        candidates = [
            os.path.join(npm_dir, 'node_modules', '@higgsfield', 'cli', 'vendor', 'hf.exe'),
            os.path.join(npm_dir, 'node_modules', '@higgsfield', 'cli', 'bin', 'hf.exe'),
            os.path.join(npm_dir, 'hf.exe'),
        ]
        for p in candidates:
            if os.path.isfile(p):
                return p
        # Fallback: `where hf.exe`
        try:
            r = subprocess.run('where hf.exe', capture_output=True, text=True, timeout=5, shell=True)
            if r.returncode == 0:
                for line in r.stdout.strip().splitlines():
                    line = line.strip()
                    if line and os.path.isfile(line):
                        return line
        except Exception:
            pass
        return ''

    # Linux / macOS
    candidates = [
        '/usr/local/bin/hf',
        '/usr/bin/hf',
        '/usr/lib/node_modules/@higgsfield/cli/vendor/hf',
        os.path.join(os.path.expanduser('~'), '.npm-global', 'bin', 'hf'),
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    # Fallback: `which hf`
    try:
        r = subprocess.run(['which', 'hf'], capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            path = r.stdout.strip().splitlines()[0] if r.stdout else ''
            if path and os.path.isfile(path):
                return path
    except Exception:
        pass
    return ''

HIGGSFIELD_EXE = _find_higgsfield_exe()
print(f'Higgsfield EXE: {HIGGSFIELD_EXE or "(not found — install with: npm install -g @higgsfield/cli)"}')

APP_CREDENTIALS = {
    'dk': {
        'client_id':     os.getenv('SHOPIFY_DK_CLIENT_ID'),
        'client_secret': os.getenv('SHOPIFY_DK_CLIENT_SECRET'),
    },
    'fr': {
        'client_id':     os.getenv('SHOPIFY_FR_CLIENT_ID'),
        'client_secret': os.getenv('SHOPIFY_FR_CLIENT_SECRET'),
    },
}

STORES = {
    'dk': os.getenv('SHOPIFY_DK_DOMAIN'),
    'fr': os.getenv('SHOPIFY_FR_DOMAIN'),
}

SCOPES      = 'write_products,read_products'
# APP_URL env var should be set on Railway to https://your-app.up.railway.app
_APP_URL    = os.getenv('APP_URL', 'http://localhost:5000').rstrip('/')
REDIRECT_URI = f'{_APP_URL}/callback'
API_VERSION  = '2024-10'

# --- Token storage ---
# Tokens are stored in tokens.json locally and can be bootstrapped
# from env vars on Railway (SHOPIFY_DK_TOKEN / SHOPIFY_FR_TOKEN).
TOKENS_FILE = 'tokens.json'
tokens = {}
if os.path.exists(TOKENS_FILE):
    try:
        with open(TOKENS_FILE) as f:
            tokens = json.load(f)
    except Exception:
        pass

# Also load from environment variables (works on Railway where filesystem is ephemeral)
for _store_key, _env_key in [('dk', 'SHOPIFY_DK_TOKEN'), ('fr', 'SHOPIFY_FR_TOKEN')]:
    _tok = os.getenv(_env_key)
    _shop = STORES.get(_store_key)
    if _tok and _shop and _store_key not in tokens:
        tokens[_store_key] = {'shop': _shop, 'token': _tok}

def save_tokens():
    try:
        with open(TOKENS_FILE, 'w') as f:
            json.dump(tokens, f)
    except Exception:
        pass  # Silently ignore on read-only filesystems (Railway)

def shopify_headers(store_key):
    t = tokens.get(store_key, {})
    return {'X-Shopify-Access-Token': t.get('token', ''), 'Content-Type': 'application/json'}

def shopify_url(store_key, path):
    shop = tokens.get(store_key, {}).get('shop') or STORES.get(store_key)
    return f"https://{shop}/admin/api/{API_VERSION}/{path}"


# --- Static files ---
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


# --- Auth ---
@app.route('/auth/<store_key>')
def auth(store_key):
    shop = STORES.get(store_key)
    if not shop:
        return 'Unknown store', 400
    creds = APP_CREDENTIALS.get(store_key)
    state = hashlib.sha256(os.urandom(16)).hexdigest()
    session['oauth_state'] = state
    session['store_key']   = store_key
    params = urllib.parse.urlencode({
        'client_id':    creds['client_id'],
        'scope':        SCOPES,
        'redirect_uri': REDIRECT_URI,
        'state':        state,
    })
    return redirect(f"https://{shop}/admin/oauth/authorize?{params}")

@app.route('/callback')
def callback():
    code      = request.args.get('code')
    shop      = request.args.get('shop')
    state     = request.args.get('state')
    store_key = session.get('store_key', 'dk')

    if state != session.get('oauth_state'):
        return 'Invalid state', 403

    creds = APP_CREDENTIALS.get(store_key, {})
    res = req.post(f"https://{shop}/admin/oauth/access_token", json={
        'client_id':     creds.get('client_id'),
        'client_secret': creds.get('client_secret'),
        'code':          code,
    })
    if res.status_code != 200:
        return f'OAuth error: {res.text}', 400

    tokens[store_key] = {'shop': shop, 'token': res.json()['access_token']}
    save_tokens()
    return redirect(f'/?auth=success&store={store_key}')

@app.route('/api/test_hf')
def test_hf():
    import os as _os, glob as _glob
    exists  = _os.path.exists(HIGGSFIELD_EXE)
    vendor  = r'C:\Users\venek\AppData\Roaming\npm\node_modules\@higgsfield\cli\vendor'
    files   = _glob.glob(vendor + r'\*')
    appdata = _os.environ.get('APPDATA', 'NOT SET')
    try:
        r = subprocess.run(
            f'"{HIGGSFIELD_EXE}" --version',
            capture_output=True, text=True, timeout=10, shell=True
        )
        return jsonify({
            'exe_exists': exists, 'vendor_files': files,
            'APPDATA': appdata, 'cwd': _os.getcwd(),
            'version': r.stdout.strip(), 'stderr': r.stderr.strip(), 'rc': r.returncode
        })
    except Exception as e:
        return jsonify({'exe_exists': exists, 'vendor_files': files, 'APPDATA': appdata, 'error': str(e)})

@app.route('/api/status')
def status():
    return jsonify({
        'dk': 'dk' in tokens,
        'fr': 'fr' in tokens,
        'anthropic': bool(ANTHROPIC_KEY and ANTHROPIC_KEY != 'VOELINJEYHIER'),
    })


# --- Scrape competitor product (server-side, geen CORS) ---
_COLOR_OPT_RE = re.compile(r'colou?r|kleur|farve|couleur', re.I)
_SIZE_OPT_RE  = re.compile(r'size|maat|taille|størrelse', re.I)


def _scrape_slugify(text):
    """Lowercase + diacritic-strip + dash-separated — matches how shops slug colours into handles."""
    normalized = unicodedata.normalize('NFKD', text or '')
    ascii_text = ''.join(c for c in normalized if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', '-', ascii_text.lower()).strip('-')


def _find_color_sibling_handles(html_text, base_handle, color_slug):
    """Find sibling colour-products linked from the storefront page HTML.

    Catches the "one product per colour" pattern (Billy J etc.) where each colour
    is a separate Shopify product whose handle is `<base>-<color>`. We only return
    handles that share the base prefix with the main product, to avoid grabbing
    unrelated products from a related-products carousel.
    """
    if not base_handle or not color_slug:
        return []
    if not base_handle.endswith('-' + color_slug):
        return []
    base_prefix = base_handle[:-(len(color_slug) + 1)]
    if len(base_prefix) < 3:
        return []  # too short to be a useful filter

    # Match /products/<base_prefix>-<anything> (terminated by quote / slash / ?)
    pattern = r'/products/(' + re.escape(base_prefix) + r'-[a-z0-9-]+)(?=[?"\'/\s>])'
    handles = set(re.findall(pattern, html_text, flags=re.I))
    handles.discard(base_handle)
    return sorted(handles)


def _fetch_product_json(scheme, netloc, handle):
    """Fetch /products/<handle>.json and return the product dict, or None."""
    url = f'{scheme}://{netloc}/products/{handle}.json'
    try:
        r = req.get(url, timeout=10, headers={'User-Agent': 'Mozilla/5.0'})
        r.raise_for_status()
        return r.json().get('product')
    except Exception as e:
        print(f"[scrape] sibling fetch failed for {handle}: {e}")
        return None


def _merge_sibling_color_products(base, siblings):
    """Merge `base` + sibling-colour products into one canonical multi-colour product.

    For each input product we identify the COLOUR option vs SIZE option (by name
    regex). The merged product exposes a single Color option (union of all values)
    + a single Size option (union of all values), and every input variant is
    rewritten so option1=colour and option2=size. Image variant_ids stay intact —
    they still point at the original variant IDs that live in the merged variants
    array, which is what the frontend's per-colour image grouping relies on.
    """
    products = [base] + [s for s in siblings if s]

    def find_color_opt(p):
        for o in p.get('options', []):
            if _COLOR_OPT_RE.search(o.get('name', '')):
                return o, p.get('options', []).index(o)
        return None, None

    def find_size_opt(p):
        for o in p.get('options', []):
            if _SIZE_OPT_RE.search(o.get('name', '')):
                return o, p.get('options', []).index(o)
        return None, None

    all_colors = []
    seen_colors = set()
    all_sizes = []
    seen_sizes = set()
    all_variants = []
    all_images = []
    next_pos = 1

    for p in products:
        c_opt, c_idx = find_color_opt(p)
        s_opt, s_idx = find_size_opt(p)

        # Colours
        if c_opt:
            for v in c_opt.get('values', []):
                key = v.lower().strip()
                if key not in seen_colors:
                    seen_colors.add(key)
                    all_colors.append(v)
        # Sizes
        if s_opt:
            for v in s_opt.get('values', []):
                if v not in seen_sizes:
                    seen_sizes.add(v)
                    all_sizes.append(v)

        # Variants — rewrite option positions so option1=colour, option2=size
        sibling_variant_ids = []
        for v in p.get('variants', []):
            color_val = (
                [v.get('option1'), v.get('option2'), v.get('option3')][c_idx]
                if c_idx is not None else None
            )
            size_val = (
                [v.get('option1'), v.get('option2'), v.get('option3')][s_idx]
                if s_idx is not None else None
            )
            new_v = dict(v)
            new_v['option1'] = color_val
            new_v['option2'] = size_val
            new_v['option3'] = None
            all_variants.append(new_v)
            if v.get('id'):
                sibling_variant_ids.append(v['id'])

        # Images — reassign position so per-sibling groups stay contiguous, AND
        # inject this sibling's variant_ids on every image. Many shops (Billy J et al.)
        # leave variant_ids empty on every image, so we'd otherwise lose the
        # per-colour grouping signal entirely. Tagging them with the sibling's
        # variants lets the frontend's extractVariantsByColor + groupImagesByColor
        # walk attribute each image to the right colour group.
        for img in p.get('images', []):
            new_img = dict(img)
            new_img['position'] = next_pos
            next_pos += 1
            existing_vids = list(new_img.get('variant_ids') or [])
            # Union — keep any vendor-supplied tagging, then fill in with the
            # sibling's own variants so untagged images still get classified.
            merged_vids = existing_vids[:]
            for vid in sibling_variant_ids:
                if vid not in merged_vids:
                    merged_vids.append(vid)
            new_img['variant_ids'] = merged_vids
            all_images.append(new_img)

    # Build the merged product (keep base's title/handle/etc as identity)
    merged = dict(base)
    merged['options'] = [
        {'name': 'Color', 'position': 1, 'values': all_colors},
        {'name': 'Size',  'position': 2, 'values': all_sizes or ['XS', 'S', 'M', 'L', 'XL']},
    ]
    merged['variants'] = all_variants
    merged['images']   = all_images
    return merged


@app.route('/api/scrape', methods=['POST'])
def scrape():
    raw = (request.json.get('url') or '').strip()
    # Strip tracking query params / fragments — Shopify needs a clean /products/handle URL
    parsed = urllib.parse.urlparse(raw)
    clean_path = parsed.path.rstrip('/')
    json_path = clean_path if clean_path.endswith('.json') else clean_path + '.json'
    html_path = clean_path[:-5] if clean_path.endswith('.json') else clean_path
    scheme   = parsed.scheme or 'https'
    json_url = urllib.parse.urlunparse((scheme, parsed.netloc, json_path, '', '', ''))
    html_url = urllib.parse.urlunparse((scheme, parsed.netloc, html_path, '', '', ''))

    try:
        r = req.get(json_url, timeout=10, headers={'User-Agent': 'Mozilla/5.0'})
        r.raise_for_status()
        base_data = r.json()
    except Exception as e:
        return jsonify({'error': str(e), 'url_tried': json_url}), 500

    base = base_data.get('product') or {}

    # Detect the "one-product-per-colour" pattern (Billy J etc.) and merge sibling
    # colour-products into the result so the dashboard sees ONE multi-colour product.
    try:
        color_opt = next(
            (o for o in base.get('options', []) if _COLOR_OPT_RE.search(o.get('name', ''))),
            None,
        )
        color_values = (color_opt or {}).get('values') or []
        if len(color_values) == 1:
            color_slug = _scrape_slugify(color_values[0])
            base_handle = base.get('handle', '')
            if base_handle.endswith('-' + color_slug):
                # Fetch the page HTML and look for sibling links
                try:
                    html_r = req.get(html_url, timeout=10, headers={'User-Agent': 'Mozilla/5.0'})
                    html_r.raise_for_status()
                    sibling_handles = _find_color_sibling_handles(html_r.text, base_handle, color_slug)
                except Exception as e:
                    print(f"[scrape] HTML fetch for siblings failed: {e}")
                    sibling_handles = []

                if sibling_handles:
                    print(f"[scrape] Found {len(sibling_handles)} sibling colour-products for '{base_handle}'")
                    sibs = []
                    for sh in sibling_handles[:15]:   # cap to avoid runaway fetches
                        sib_product = _fetch_product_json(scheme, parsed.netloc, sh)
                        if sib_product:
                            sibs.append(sib_product)
                    if sibs:
                        merged = _merge_sibling_color_products(base, sibs)
                        return jsonify({'product': merged})
    except Exception as e:
        print(f"[scrape] sibling-merge step failed (continuing with base only): {e}")

    return jsonify(base_data)


# --- Debug: inspect siblings setup for a given product name ---
@app.route('/api/debug_siblings')
def debug_siblings():
    """Diagnose why Pipeline-theme siblings might not be working for a given product."""
    store = request.args.get('store', 'dk')
    name  = request.args.get('name', '').strip()
    if store not in tokens:
        return jsonify({'error': f'Not authenticated for {store}'}), 401
    if not name:
        return jsonify({'error': 'Provide ?name=Elsa'}), 400

    hdrs = shopify_headers(store)
    report = {'store': store, 'name': name, 'products': [], 'collection': None, 'issues': []}

    # 1. Find all products with this title.
    # NOTE: REST `products.json?title=` filter is unreliable (only matches sometimes / lags
    # indexing). GraphQL query:"title:..." is the supported way.
    try:
        # Escape double-quotes in title for safe embedding in the GQL query string.
        safe_title = name.replace('\\', '\\\\').replace('"', '\\"')
        gql_body = {
            'query': '{ products(first: 20, query: "title:\\"' + safe_title + '\\"") { '
                     'edges { node { id legacyResourceId title handle status } } } }'
        }
        gql_r = req.post(shopify_url(store, 'graphql.json'), headers=hdrs, json=gql_body, timeout=15)
        edges = (gql_r.json().get('data') or {}).get('products', {}).get('edges', []) or []
        products = []
        for e in edges:
            n = e.get('node') or {}
            products.append({
                'id':     n.get('legacyResourceId') or n.get('id', '').rsplit('/', 1)[-1],
                'title':  n.get('title'),
                'handle': n.get('handle'),
                'status': (n.get('status') or '').lower(),
            })
    except Exception as e:
        return jsonify({'error': f'Products lookup failed: {e}'}), 500

    if not products:
        report['issues'].append(f'No products with title "{name}" found.')
        return jsonify(report)

    siblings_handles = set()
    for p in products:
        pid = p['id']
        # Fetch metafields for each product
        try:
            mr = req.get(shopify_url(store, f'products/{pid}/metafields.json'), headers=hdrs, timeout=15)
            mfields = mr.json().get('metafields', [])
        except Exception:
            mfields = []
        mf_lookup = {f"{m['namespace']}.{m['key']}": m.get('value') for m in mfields}
        cutline = mf_lookup.get('theme.cutline')
        siblings = mf_lookup.get('theme.siblings')
        if siblings:
            siblings_handles.add(siblings)
        report['products'].append({
            'id': pid,
            'title': p.get('title'),
            'handle': p.get('handle'),
            'status': p.get('status'),
            'cutline': cutline,
            'siblings': siblings,
        })

    if not siblings_handles:
        report['issues'].append('No products have a theme.siblings metafield set.')
        return jsonify(report)

    # 2. For each unique siblings handle, look up the collection.
    # Use GraphQL collectionByHandle which covers BOTH custom and smart collections —
    # the previous REST `custom_collections.json?handle=` lookup missed smart collections
    # entirely (which is why we hadn't noticed the suffix bug on Aria).
    for handle in siblings_handles:
        coll_info = None
        try:
            safe_h = handle.replace('\\', '\\\\').replace('"', '\\"')
            gql_body = {
                'query': '{ collectionByHandle(handle:"' + safe_h + '") { '
                         'id legacyResourceId handle title updatedAt productsCount { count } '
                         'products(first: 50) { edges { node { title status } } } } }'
            }
            gr = req.post(shopify_url(store, 'graphql.json'), headers=hdrs, json=gql_body, timeout=15)
            coll_info = (gr.json().get('data') or {}).get('collectionByHandle')
        except Exception as e:
            report['issues'].append(f'Collection lookup failed for {handle}: {e}')
            continue
        if not coll_info:
            report['issues'].append(f'Collection with handle "{handle}" does not exist in Shopify.')
            continue
        coll_products = [edge['node'] for edge in coll_info.get('products', {}).get('edges', [])]
        report['collection'] = {
            'id': coll_info.get('legacyResourceId'),
            'handle': coll_info.get('handle'),
            'title': coll_info.get('title'),
            'updated_at': coll_info.get('updatedAt'),
            'product_count': (coll_info.get('productsCount') or {}).get('count', len(coll_products)),
            'product_titles': [
                p.get('title') + ' (' + (p.get('status') or '?').lower() + ')'
                for p in coll_products
            ],
        }
        if coll_products and all((p.get('status') or '').lower() == 'draft' for p in coll_products):
            report['issues'].append('All products in the collection are draft — theme may not show drafts.')

    if not report['issues']:
        report['issues'].append('No obvious issues found. Theme settings may need to be checked manually.')
    return jsonify(report)


# --- Debug: list metafield definitions for products ---
@app.route('/api/debug_metafields')
def debug_metafields():
    store = request.args.get('store', 'dk')
    if store not in tokens:
        return jsonify({'error': f'Not authenticated for {store}'}), 401
    try:
        # Get metafield DEFINITIONS for product owner type
        url = shopify_url(store, 'metafield_definitions.json?owner_type=PRODUCT')
        r = req.get(url, headers=shopify_headers(store), timeout=15)
        if r.status_code != 200:
            return jsonify({'status': r.status_code, 'response': r.text}), 500
        defs = r.json().get('metafield_definitions', [])
        simplified = [
            {
                'name': d.get('name'),
                'namespace': d.get('namespace'),
                'key': d.get('key'),
                'type': d.get('type', {}).get('name') if isinstance(d.get('type'), dict) else d.get('type'),
                'description': d.get('description'),
            }
            for d in defs
        ]
        return jsonify({'count': len(simplified), 'definitions': simplified})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# --- Get existing product names to avoid duplicates ---
@app.route('/api/names', methods=['POST'])
def get_names():
    store = request.json.get('store', 'dk')
    if store not in tokens:
        return jsonify({'names': []})
    try:
        names = []
        # Comma-separated list = all statuses (active + draft + archived).
        # Without this param Shopify only returns active products by default.
        next_url = shopify_url(store, 'products.json?fields=title&status=active,draft,archived&limit=250')
        pages = 0
        while next_url and pages < 10:  # max 2500 products = plenty
            r = req.get(next_url, headers=shopify_headers(store), timeout=15)
            data = r.json()
            for p in data.get('products', []):
                if p.get('title'):
                    names.append(p['title'])
            # Pagination via Link header
            link = r.headers.get('Link', '')
            next_url = None
            for part in link.split(','):
                if 'rel="next"' in part:
                    url_part = part.split(';')[0].strip().lstrip('<').rstrip('>')
                    if url_part.startswith('http'):
                        next_url = url_part
                    break
            pages += 1
        print(f'[names] {store}: {len(names)} product titles fetched across {pages} pages')
        return jsonify({'names': names})
    except Exception as e:
        print(f'[names] Error: {e}')
        return jsonify({'names': [], 'error': str(e)})


# --- Generate content via Claude ---
@app.route('/api/generate', methods=['POST'])
def generate():
    if not ANTHROPIC_KEY or ANTHROPIC_KEY == 'VOELINJEYHIER':
        return jsonify({'error': 'Anthropic API key missing — set ANTHROPIC_API_KEY in environment variables'}), 400

    import anthropic
    data          = request.json
    store         = data.get('store', 'dk')
    product_name  = data.get('product_name', '')
    product_title = data.get('product_title', '')
    keywords      = data.get('keywords', [])
    language      = 'Deens' if store == 'dk' else 'Frans'

    example = """Komfortabel og nem at bære

Liviah er en bluse med krave og V-udskæring med knapper foran. De korte ærmer giver et afslappet udtryk og gør blusen behagelig til daglig brug. Det ensfarvede design giver et roligt look og er nemt at kombinere med forskellige bukser.

• Bomuldsblanding: behageligt materiale til daglig brug
• Krave med V-udskæring: enkel og pæn detalje
• Korte ærmer: dejlige til varmere vejr
• Knapdetalje foran: subtilt accent
• Normal pasform: sidder komfortabelt og giver god bevægelighed

Liviah er en bluse, som er nem at tage på, og som føles behagelig hele dagen."""

    prompt = f"""Je bent een productschrijver voor een vrouwenmodezaak. Schrijf productcontent in het {language} voor een product genaamd "{product_name}".

Competitor producttitel: {product_title}
Keywords (verwerk de relevantste): {', '.join(keywords[:12])}

Schrijf exact in de stijl van dit voorbeeld:
---
{example}
---

Regels:
- Gebruik productnaam ({product_name}) in eerste én laatste zin
- Eerste regel: korte pakkende zin over comfort/draagbaarheid (geen uitroepteken)
- Dan alinea met productnaam + kernkenmerken van het product
- Dan 5 bulletpoints: **eigenschap**: korte uitleg
- Slotszin over hoe het voelt om te dragen
- Rustige toon, geen hype, geen superlatieven

Geef ook:
- meta_description: max 155 tekens, SEO-geoptimaliseerd voor {language}
- m_title_specs: één beschrijvende zin voor Google Shopping (wordt gebruikt als: {product_name} | m_title_specs)

Antwoord uitsluitend als geldig JSON zonder extra tekst:
{{"description": "...", "meta_description": "...", "m_title_specs": "..."}}"""

    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
    msg = client.messages.create(
        model='claude-sonnet-4-5',
        max_tokens=1200,
        messages=[{'role': 'user', 'content': prompt}]
    )
    text = msg.content[0].text.strip()
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        return jsonify(json.loads(match.group()))
    return jsonify({'error': 'Kon respons niet parsen', 'raw': text}), 500


# --- Publish helpers (shared by /api/publish and the granular per-variant endpoints) ---

def _publish_to_html(text):
    """Convert plain-text description to body_html (lists when '•' or '-')."""
    lines  = (text or '').strip().splitlines()
    html   = []
    bullets = []
    def flush_bullets():
        if bullets:
            html.append('<ul>' + ''.join(f'<li>{b}</li>' for b in bullets) + '</ul>')
            bullets.clear()
    for line in lines:
        stripped = line.strip()
        if not stripped:
            flush_bullets()
            continue
        if stripped.startswith('•') or stripped.startswith('-'):
            bullets.append(stripped.lstrip('•- ').strip())
        else:
            flush_bullets()
            html.append(f'<p>{stripped}</p>')
    flush_bullets()
    return '\n'.join(html)


def _publish_strip_diacritics(text):
    normalized = unicodedata.normalize('NFKD', text or '')
    return ''.join(c for c in normalized if not unicodedata.combining(c))


def _publish_slug(text):
    ascii_text = _publish_strip_diacritics(text)
    return re.sub(r'[^a-z0-9]+', '-', ascii_text.lower()).strip('-')


def _publish_make_sku(p_name, color, size):
    n = (p_name or '').strip().replace(' ', '')
    c = (color or '').strip().replace(' ', '')
    s = (size or '').strip().replace(' ', '')
    return f'VIONNA-{n}-{c}-{s}'


def _publish_make_handle(p_name, color):
    return f'{_publish_slug(p_name)}-{_publish_slug(color)}'.strip('-')


def _publish_normalize_price(store, price_raw):
    """Strip currency suffix + apply per-store psychological suffix (.95 DK / .99 FR)."""
    raw = (price_raw or '0.00').replace(',', '.').replace(' DKK', '').replace(' EUR', '').strip()
    try:
        price_int = int(float(raw))
        suffix = '.95' if store == 'dk' else '.99'
        return f'{price_int}{suffix}'
    except Exception:
        return raw


def _probe_collection_by_handle(store, handle, hdrs):
    """Return (id, handle) for any custom/smart collection at `handle`, else (None, None)."""
    try:
        gql_res = req.post(
            shopify_url(store, 'graphql.json'),
            headers=hdrs,
            json={'query': 'query($h:String!){ collectionByHandle(handle:$h){ id handle title } }',
                  'variables': {'h': handle}},
            timeout=15,
        )
        if gql_res.status_code == 200:
            node = (gql_res.json().get('data') or {}).get('collectionByHandle')
            if node:
                raw_id = node.get('id', '')
                try:
                    return int(raw_id.rsplit('/', 1)[-1]), node.get('handle')
                except Exception:
                    return None, None
    except Exception as e:
        print(f"[publish] collectionByHandle probe failed: {e}")
    return None, None


def _ensure_siblings_collection(store, product_name, siblings_handle, hdrs, base):
    """Create or reuse the siblings collection. Returns (collection_id, actual_handle, was_reused).

    Handles the case where the desired handle is already taken (custom OR smart) —
    in that case we reuse the existing collection so we don't end up with two
    overlapping collections + a wrong metafield (cf. Aria FR bug).
    """
    if not siblings_handle:
        return None, siblings_handle, False

    existing_id, existing_handle = _probe_collection_by_handle(store, siblings_handle, hdrs)
    if existing_id and existing_handle == siblings_handle:
        print(f"[publish] Reusing existing collection at handle '{existing_handle}' (id={existing_id})")
        return existing_id, existing_handle, True

    coll_res = req.post(f"{base}custom_collections.json", headers=hdrs, json={
        'custom_collection': {
            'title':     product_name + ' Siblings',
            'handle':    siblings_handle,
            'published': True,
        }
    })
    if coll_res.status_code not in (200, 201):
        print(f"[publish] WARNING: collection creation failed: {coll_res.status_code} — {coll_res.text[:200]}")
        return None, siblings_handle, False

    coll_payload    = coll_res.json().get('custom_collection', {})
    collection_id   = coll_payload.get('id')
    returned_handle = coll_payload.get('handle') or siblings_handle

    if returned_handle != siblings_handle:
        # Shopify auto-suffixed our handle. Try to find the existing collision and reuse it.
        print(f"[publish] WARNING: Shopify renamed handle: '{siblings_handle}' -> '{returned_handle}'")
        conflict_id, conflict_handle = _probe_collection_by_handle(store, siblings_handle, hdrs)
        if conflict_id and conflict_handle == siblings_handle:
            print(f"[publish] Deleting suffixed copy id={collection_id}, reusing pre-existing id={conflict_id}")
            try:
                req.delete(shopify_url(store, f'custom_collections/{collection_id}.json'),
                           headers=hdrs, timeout=15)
            except Exception as e:
                print(f"[publish] Suffixed-copy delete failed: {e}")
            return conflict_id, conflict_handle, True
        return collection_id, returned_handle, False

    return collection_id, returned_handle, False


def _publish_one_variant(
    *,
    store, product_name, color, sizes,
    description_html, meta_description, m_title_specs,
    price, compare_at_price, product_type,
    images,            # list of image URLs for THIS variant
    collection_id,     # may be None (skip the collects.json POST)
    actual_handle,     # value to write into theme.siblings metafield
    hdrs, base,
):
    """Create one colour-variant product. Returns dict:
        { product_id, product_url, metafield_errors, error? }
    """
    size_option_name = 'Størrelse' if store == 'dk' else 'Taille'

    # Dedupe images while preserving order, drop non-http
    seen_imgs = set()
    deduped = [u for u in images if u.startswith('http') and not (u in seen_imgs or seen_imgs.add(u))]
    img_payload = [{'src': img} for img in deduped[:10]]

    product_handle = _publish_make_handle(product_name, color)
    product_payload = {
        'product': {
            'title':        product_name,
            'handle':       product_handle,
            'body_html':    description_html,
            'product_type': product_type,
            'status':       'draft',
            'variants': [
                {
                    'option1':              size,
                    'price':                price,
                    'compare_at_price':     compare_at_price,
                    'sku':                  _publish_make_sku(product_name, color, size),
                    'inventory_management': None,
                }
                for size in sizes
            ],
            'options': [{'name': size_option_name, 'values': sizes}],
            'images':  img_payload,
        }
    }
    print(f"[publish] Color '{color}' handle='{product_handle}' images={len(img_payload)}")

    prod_res = req.post(f"{base}products.json", headers=hdrs, json=product_payload)
    if prod_res.status_code not in (200, 201):
        return {'error': f'Product create failed ({prod_res.status_code}): {prod_res.text[:200]}',
                'metafield_errors': []}

    prod_data = prod_res.json()['product']
    prod_id   = prod_data['id']

    # --- Metafields ---
    metafields = [
        {'namespace': 'theme',  'key': 'cutline',                       'value': color,            'type': 'single_line_text_field'},
        {'namespace': 'theme',  'key': 'siblings',                      'value': actual_handle,    'type': 'single_line_text_field'},
        {'namespace': 'custom', 'key': 'm_title_specs_multi_line_text_','value': m_title_specs,    'type': 'multi_line_text_field'},
        {'namespace': 'global', 'key': 'description_tag',               'value': meta_description, 'type': 'single_line_text_field'},
    ]
    mf_errors = []
    for mf in metafields:
        if not mf['value']:
            mf_errors.append(f"{mf['key']}: skipped (empty value)")
            continue
        mf_res = req.post(
            shopify_url(store, f'products/{prod_id}/metafields.json'),
            headers=hdrs,
            json={'metafield': mf}
        )
        if mf_res.status_code not in (200, 201):
            # Retry once with the alternate text-field type
            alt_type = 'single_line_text_field' if mf['type'] == 'multi_line_text_field' else 'multi_line_text_field'
            mf_res2 = req.post(
                shopify_url(store, f'products/{prod_id}/metafields.json'),
                headers=hdrs,
                json={'metafield': {**mf, 'type': alt_type}}
            )
            if mf_res2.status_code not in (200, 201):
                mf_errors.append(f"{mf['key']} (both types failed): {mf_res2.text[:120]}")

    # --- Assign first image to all variants ---
    prod_images   = prod_data.get('images', [])
    prod_variants = prod_data.get('variants', [])
    if prod_images and prod_variants:
        first_image_id = prod_images[0]['id']
        for variant in prod_variants:
            req.put(
                shopify_url(store, f'variants/{variant["id"]}.json'),
                headers=hdrs,
                json={'variant': {'id': variant['id'], 'image_id': first_image_id}}
            )

    # --- Add to siblings collection ---
    if collection_id:
        req.post(f"{base}collects.json", headers=hdrs, json={
            'collect': {'product_id': prod_id, 'collection_id': collection_id}
        })

    shop_domain = tokens.get(store, {}).get('shop', '')
    product_url = f'https://{shop_domain}/admin/products/{prod_id}' if shop_domain else ''
    return {'product_id': prod_id, 'product_url': product_url, 'metafield_errors': mf_errors}


# --- Granular publish endpoints (for live per-variant progress in the dashboard) ---

@app.route('/api/publish/start_store', methods=['POST'])
def publish_start_store():
    """Step 1 of granular publish: create-or-reuse the siblings collection.
    Returns the collection_id + actual_handle so the frontend can pass them
    along to subsequent /create_variant calls.
    """
    data = request.json or {}
    store = data.get('store', 'dk')
    if store not in tokens:
        return jsonify({'error': f'Not authenticated for {store.upper()} store.'}), 401

    product_name    = data.get('product_name', '')
    siblings_handle = data.get('siblings_handle', '')
    hdrs            = shopify_headers(store)
    base            = shopify_url(store, '')

    collection_id, actual_handle, reused = _ensure_siblings_collection(
        store, product_name, siblings_handle, hdrs, base
    )

    shop_domain    = tokens.get(store, {}).get('shop', '')
    collection_url = (
        f'https://{shop_domain}/admin/collections/{collection_id}'
        if shop_domain and collection_id else None
    )
    return jsonify({
        'success':        True,
        'collection_id':  collection_id,
        'actual_handle':  actual_handle,
        'collection_url': collection_url,
        'reused':         reused,
    })


@app.route('/api/publish/create_variant', methods=['POST'])
def publish_create_variant():
    """Step 2 of granular publish: create ONE colour-variant product."""
    data = request.json or {}
    store = data.get('store', 'dk')
    if store not in tokens:
        return jsonify({'error': f'Not authenticated for {store.upper()} store.'}), 401

    product_name     = data.get('product_name', '')
    color            = data.get('color', '')
    sizes            = data.get('sizes', ['XS', 'S', 'M', 'L', 'XL'])
    description_html = _publish_to_html(data.get('description', ''))
    meta_description = data.get('meta_description', '')
    m_title_specs    = data.get('m_title_specs', '')
    product_type     = data.get('product_type', '')
    price            = _publish_normalize_price(store, data.get('price', '0.00'))
    compare_at_price = data.get('compare_at_price')
    images           = data.get('images', []) or []
    collection_id    = data.get('collection_id')
    actual_handle    = data.get('actual_handle', '') or data.get('siblings_handle', '')

    hdrs = shopify_headers(store)
    base = shopify_url(store, '')

    result = _publish_one_variant(
        store=store,
        product_name=product_name,
        color=color,
        sizes=sizes,
        description_html=description_html,
        meta_description=meta_description,
        m_title_specs=m_title_specs,
        price=price,
        compare_at_price=compare_at_price,
        product_type=product_type,
        images=images,
        collection_id=collection_id,
        actual_handle=actual_handle,
        hdrs=hdrs,
        base=base,
    )
    if 'error' in result:
        return jsonify({'success': False, **result}), 500
    return jsonify({'success': True, **result})


# --- Publish to Shopify ---
@app.route('/api/publish', methods=['POST'])
def publish():
    data      = request.json
    store     = data.get('store', 'dk')

    if store not in tokens:
        return jsonify({'error': f'Not authenticated for {store.upper()} store. Please click Authorize first.'}), 401

    product_name     = data.get('product_name', '')
    meta_description = data.get('meta_description', '')
    m_title_specs    = data.get('m_title_specs', '')
    product_type     = data.get('product_type', '')
    price_raw        = data.get('price', '0.00').replace(',', '.').replace(' DKK','').replace(' EUR','').strip()
    # Adjust selling price suffix: .95 for DK, .99 for FR
    try:
        price_int   = int(float(price_raw))
        suffix      = '.95' if store == 'dk' else '.99'
        price       = f'{price_int}{suffix}'
    except Exception:
        price       = price_raw
    print(f"[publish] Price '{price_raw}' -> '{price}' (store: {store})")
    compare_at_price = data.get('compare_at_price')   # optional, None = no compare price
    size_option_name = 'Størrelse' if store == 'dk' else 'Taille'
    colors           = data.get('colors', [])
    sizes            = data.get('sizes', ['XS', 'S', 'M', 'L', 'XL'])
    siblings_handle  = data.get('siblings_handle', '')
    # images_by_color: { 'shared': [...], 'Sort': [...], 'Hvid': [...], ... }
    images_by_color  = data.get('images_by_color', {}) or {}
    images_flat      = data.get('images', []) or []
    # Use 'shared' images if any; otherwise fall back to flat images list (legacy or single-color)
    shared_images    = images_by_color.get('shared') or images_flat
    print(f"[publish] Received: {len(images_flat)} flat images, color-keys: {list(images_by_color.keys())}, shared: {len(shared_images)}")

    # Convert plain-text description to body_html
    def to_html(text):
        lines  = text.strip().splitlines()
        html   = []
        bullets = []
        def flush_bullets():
            if bullets:
                html.append('<ul>' + ''.join(f'<li>{b}</li>' for b in bullets) + '</ul>')
                bullets.clear()
        for line in lines:
            stripped = line.strip()
            if not stripped:
                flush_bullets()
                continue
            if stripped.startswith('•') or stripped.startswith('-'):
                bullets.append(stripped.lstrip('•- ').strip())
            else:
                flush_bullets()
                html.append(f'<p>{stripped}</p>')
        flush_bullets()
        return '\n'.join(html)

    description = to_html(data.get('description', ''))

    hdrs    = shopify_headers(store)
    base    = shopify_url(store, '')

    # 1. Maak siblings collectie aan
    # IMPORTANT: published=True is required for Pipeline theme siblings to work —
    # the Liquid template queries the storefront context which can't see unpublished collections.
    #
    # We must ALSO handle the case where a collection (custom OR smart) already lives at
    # `siblings_handle`. If we naively POST, Shopify will silently rename our new collection
    # to `<handle>-1` and our publish would then write the WRONG handle into theme.siblings —
    # which is exactly what broke Aria on FR. Strategy:
    #   1. Probe with GraphQL collectionByHandle (covers both custom + smart).
    #   2. If the handle is already taken, reuse that collection's id + handle.
    #   3. Otherwise create. Always read the ACTUAL handle from the response (it may differ
    #      from what we requested even after the probe if a race happens).
    collection_id  = None
    actual_handle  = siblings_handle    # what we'll write into theme.siblings metafield

    def _probe_existing_collection(handle):
        """Return (id, handle) for any custom/smart collection at `handle`, else (None, None)."""
        try:
            gql_res = req.post(
                shopify_url(store, 'graphql.json'),
                headers=hdrs,
                json={'query': 'query($h:String!){ collectionByHandle(handle:$h){ id handle title } }',
                      'variables': {'h': handle}},
                timeout=15,
            )
            if gql_res.status_code == 200:
                node = (gql_res.json().get('data') or {}).get('collectionByHandle')
                if node:
                    raw_id = node.get('id', '')
                    try:
                        return int(raw_id.rsplit('/', 1)[-1]), node.get('handle')
                    except Exception:
                        return None, None
        except Exception as e:
            print(f"[publish] collectionByHandle probe failed: {e}")
        return None, None

    existing_id, existing_handle = _probe_existing_collection(siblings_handle) if siblings_handle else (None, None)
    if existing_id and existing_handle == siblings_handle:
        collection_id = existing_id
        actual_handle = existing_handle
        print(f"[publish] Reusing existing collection at handle '{actual_handle}' (id={collection_id})")
    else:
        coll_res = req.post(f"{base}custom_collections.json", headers=hdrs, json={
            'custom_collection': {
                'title':     product_name + ' Siblings',
                'handle':    siblings_handle,
                'published': True,
            }
        })
        if coll_res.status_code in [200, 201]:
            coll_payload   = coll_res.json().get('custom_collection', {})
            collection_id  = coll_payload.get('id')
            returned_handle = coll_payload.get('handle') or siblings_handle
            if returned_handle != siblings_handle:
                # Shopify suffixed our handle because of a conflict we didn't catch above.
                # Two equally-bad options: (a) accept the suffix and update metafields, or
                # (b) delete this collection and reuse the existing one. We do (b) when we
                # can find the original, otherwise fall back to (a).
                print(f"[publish] WARNING: Shopify renamed handle: '{siblings_handle}' -> '{returned_handle}'")
                conflict_id, conflict_handle = _probe_existing_collection(siblings_handle)
                if conflict_id and conflict_handle == siblings_handle:
                    # Throw away the suffixed copy and reuse the pre-existing one.
                    print(f"[publish] Deleting suffixed copy id={collection_id}, reusing pre-existing id={conflict_id}")
                    try:
                        req.delete(shopify_url(store, f'custom_collections/{collection_id}.json'),
                                   headers=hdrs, timeout=15)
                    except Exception as e:
                        print(f"[publish] Suffixed-copy delete failed: {e}")
                    collection_id  = conflict_id
                    actual_handle  = conflict_handle
                else:
                    # No pre-existing collection found at the desired handle; accept suffix.
                    actual_handle = returned_handle
            else:
                actual_handle = returned_handle
        else:
            print(f"[publish] WARNING: collection creation failed: {coll_res.status_code} — {coll_res.text[:200]}")

    created = []

    # Primary color = first color in list (matches the original competitor product).
    # Steps 1-4 ("shared") photos depict that original color, so they ONLY go to
    # the primary color duplicate. Other color duplicates get only their step 5 photos.
    primary_color = colors[0] if colors else None

    # Helpers for slug / SKU generation
    def _strip_diacritics(text):
        normalized = unicodedata.normalize('NFKD', text or '')
        return ''.join(c for c in normalized if not unicodedata.combining(c))

    def _slug(text):
        ascii_text = _strip_diacritics(text)
        return re.sub(r'[^a-z0-9]+', '-', ascii_text.lower()).strip('-')

    def make_sku(p_name, color, size):
        # Match Hextom's format for consistency with bulk-backfilled existing products:
        # VIONNA-<title>-<cutline>-<option1>  (keeps original case + accents)
        n = (p_name or '').strip().replace(' ', '')
        c = (color or '').strip().replace(' ', '')
        s = (size or '').strip().replace(' ', '')
        return f'VIONNA-{n}-{c}-{s}'

    def make_handle(p_name, color):
        return f'{_slug(p_name)}-{_slug(color)}'.strip('-')

    # 2. Maak per kleur een product aan
    for color in colors:
        color_specific = images_by_color.get(color, [])
        if color == primary_color:
            # Primary color: shared (step 1-4) photos + its own step 5 photos
            all_imgs = shared_images + color_specific
        else:
            # Other colors: only their own step 5 photos (steps 1-4 don't match)
            all_imgs = color_specific
        # Deduplicate while preserving order
        seen_imgs = set()
        all_imgs = [u for u in all_imgs if not (u in seen_imgs or seen_imgs.add(u))]
        img_payload = [{'src': img} for img in all_imgs[:10] if img.startswith('http')]
        primary_tag = ' (PRIMARY)' if color == primary_color else ''
        print(f"[publish] Color '{color}'{primary_tag}: {len(shared_images) if color == primary_color else 0} shared + {len(color_specific)} color-specific = {len(img_payload)} total images")

        product_handle = make_handle(product_name, color)
        product_payload = {
            'product': {
                'title':        product_name,
                'handle':       product_handle,
                'body_html':    description,
                'product_type': product_type,
                'status':       'draft',
                'variants': [
                    {
                        'option1': size,
                        'price': price,
                        'compare_at_price': compare_at_price,
                        'sku': make_sku(product_name, color, size),
                        'inventory_management': None,
                    }
                    for size in sizes
                ],
                'options': [
                    {'name': size_option_name, 'values': sizes},
                ],
                'images': img_payload,
            }
        }
        print(f"[publish] Product handle: '{product_handle}' | Sample SKU: '{make_sku(product_name, color, sizes[0] if sizes else 'M')}'")

        prod_res = req.post(f"{base}products.json", headers=hdrs, json=product_payload)
        if prod_res.status_code in [200, 201]:
            prod_data  = prod_res.json()['product']
            prod_id    = prod_data['id']
            created.append(prod_id)

            # --- Metafields via separate POST ---
            # Namespace+key MUST match the metafield definitions configured in the Shopify store.
            metafields = [
                {'namespace': 'theme',  'key': 'cutline',                       'value': color,            'type': 'single_line_text_field'},
                # IMPORTANT: write the ACTUAL collection handle (may differ from siblings_handle
                # if Shopify renamed due to a conflict). Otherwise the Pipeline theme template
                # queries by handle and gets nothing → siblings invisible.
                {'namespace': 'theme',  'key': 'siblings',                      'value': actual_handle,    'type': 'single_line_text_field'},
                {'namespace': 'custom', 'key': 'm_title_specs_multi_line_text_','value': m_title_specs,    'type': 'multi_line_text_field'},
                {'namespace': 'global', 'key': 'description_tag',               'value': meta_description, 'type': 'single_line_text_field'},
            ]
            mf_errors = []
            for mf in metafields:
                if not mf['value']:
                    mf_errors.append(f"{mf['key']}: skipped (empty value)")
                    continue
                print(f"[mf] Sending {mf['namespace']}.{mf['key']} = {repr(mf['value'][:50])} (type: {mf['type']})")
                mf_res = req.post(
                    shopify_url(store, f'products/{prod_id}/metafields.json'),
                    headers=hdrs,
                    json={'metafield': mf}
                )
                print(f"[mf] Response {mf['key']}: {mf_res.status_code} — {mf_res.text[:200]}")
                if mf_res.status_code not in [200, 201]:
                    # Retry with the other type
                    alt_type = 'single_line_text_field' if mf['type'] == 'multi_line_text_field' else 'multi_line_text_field'
                    mf2 = {**mf, 'type': alt_type}
                    print(f"[mf] Retrying {mf['key']} with type {alt_type}")
                    mf_res2 = req.post(
                        shopify_url(store, f'products/{prod_id}/metafields.json'),
                        headers=hdrs,
                        json={'metafield': mf2}
                    )
                    print(f"[mf] Retry response {mf['key']}: {mf_res2.status_code} — {mf_res2.text[:200]}")
                    if mf_res2.status_code not in [200, 201]:
                        mf_errors.append(f"{mf['key']} ({mf['type']} + {alt_type} both failed): {mf_res2.text[:120]}")

            # --- Assign first product image to all variants ---
            prod_images  = prod_data.get('images', [])
            prod_variants = prod_data.get('variants', [])
            if prod_images and prod_variants:
                first_image_id = prod_images[0]['id']
                for variant in prod_variants:
                    req.put(
                        shopify_url(store, f'variants/{variant["id"]}.json'),
                        headers=hdrs,
                        json={'variant': {'id': variant['id'], 'image_id': first_image_id}}
                    )

            # --- Voeg toe aan siblings collectie ---
            if collection_id:
                req.post(f"{base}collects.json", headers=hdrs, json={
                    'collect': {'product_id': prod_id, 'collection_id': collection_id}
                })

    # Build Shopify admin URLs for created products
    shop_domain = tokens.get(store, {}).get('shop', '')
    product_urls = [
        f'https://{shop_domain}/admin/products/{pid}'
        for pid in created
    ] if shop_domain else []
    collection_url = (
        f'https://{shop_domain}/admin/collections/{collection_id}'
        if shop_domain and collection_id else None
    )

    return jsonify({
        'success':          True,
        'collection_id':    collection_id,
        'collection_url':   collection_url,
        'products_created': len(created),
        'product_ids':      created,
        'product_urls':     product_urls,
        'metafield_errors': mf_errors if 'mf_errors' in dir() else [],
    })


# --- Nano Banana prompt templates (from PDF workflow) ---
NANO_BANANA_PROMPTS = {
    1: ("I've added a photo of a woman wearing a dress. I only want to use the background "
        "from this photo. Then, I want you to place the {product_type} on a realistic woman "
        "model. It should be completely unnoticeable that it's an AI-generated model — "
        "it must look fully natural and real."),
    2: ("I've uploaded a photo of a woman wearing a {product_type}. I want you to use only "
        "the background from this image. After that, please generate a female model where her "
        "entire face is clearly visible. Make sure to replicate all details of the {product_type} "
        "accurately. Pay special attention to the design elements that must be visible in the result."),
    3: ("I've added a photo of a woman wearing a {product_type}. This is our model, and we do "
        "not want the background, model, or product to be changed. Now, we want to see the back "
        "view of the same product, on the same model, with the same background. Please generate "
        "a realistic back-side image while maintaining the current setup exactly as it is."),
    4: ("I've added a photo of a woman wearing a {product_type}. This is our model, and we don't "
        "want any changes to the background, model, or the product. Now, we want a close-up image "
        "of the material. Please make sure the zoomed-in shot still matches the original style "
        "and lighting, and focuses clearly on the texture and details."),
    5: ("I've uploaded multiple reference images. The FIRST image is our model wearing a "
        "{product_type} — keep this model, her face, the background, the lighting, the styling, "
        "the fit and the silhouette EXACTLY identical. The remaining images are color references "
        "from the competitor showing the same {product_type} in {color}; use them only to match "
        "the exact {color} colour, texture and fabric finish. Generate the same model in a slightly "
        "different pose, wearing the {product_type} in {color}. Do not copy the competitor's model, "
        "face, body, or background — only mirror the colour from those references onto our model's "
        "outfit."),
    # === Prompts 11-14: step 5 color variants in the four step formats (1-4) ===
    # IMAGE 1 = our existing model (framing + composition reference, NOT colour).
    # IMAGES 2+ = competitor colour references — these are the GROUND TRUTH for colour.
    # The colour name ({color}) is just a label; the model must NOT interpret it from prior
    # knowledge — it must match the EXACT shade visible in the reference images.
    11: ("I've uploaded reference images with TWO different roles:\n"
         "- IMAGE 1: our existing model wearing a {product_type} — use her face, body, full-body framing, "
         "background, lighting and styling. A slightly different pose is allowed.\n"
         "- IMAGES 2+: competitor garment colour references. These define the EXACT shade, hue, saturation, "
         "texture and fabric finish for the new variant. Use them ONLY for colour information.\n\n"
         "Task: generate a full-body shot of OUR model (from IMAGE 1) wearing the {product_type} in the "
         "EXACT colour shown in IMAGES 2+. Critical: do NOT guess the colour from the label '{color}' — "
         "match precisely what you see in the reference images, including subtle tints (e.g. greys, "
         "muted tones, sage vs. mint, dusty pink vs. bright pink). Ignore the competitor's model, face, "
         "body and background entirely — only mirror the garment colour."),
    12: ("I've uploaded reference images with TWO different roles:\n"
         "- IMAGE 1: our existing model with her face clearly visible and product details prominent.\n"
         "- IMAGES 2+: competitor garment colour references — EXACT colour ground truth.\n\n"
         "Task: generate a detailed model shot of OUR model (from IMAGE 1) with her full face clearly "
         "visible, wearing the {product_type} in the EXACT colour shown in IMAGES 2+. Critical: match "
         "the precise shade from the reference photos, not your prior idea of '{color}'. Keep our model, "
         "background and styling identical to IMAGE 1."),
    13: ("I've uploaded reference images with TWO different roles:\n"
         "- IMAGE 1: our existing model (same setup, model, background).\n"
         "- IMAGES 2+: competitor garment colour references — EXACT colour ground truth.\n\n"
         "Task: generate a realistic BACK VIEW of OUR model wearing the {product_type} in the EXACT "
         "colour shown in IMAGES 2+. Critical: do not interpret '{color}' loosely — copy the precise "
         "shade, saturation and finish you see in the references. Same model, same background as "
         "IMAGE 1."),
    14: ("I've uploaded reference images with TWO different roles:\n"
         "- IMAGE 1: our model wearing the {product_type} (for style + lighting reference).\n"
         "- IMAGES 2+: competitor garment colour references — EXACT colour ground truth.\n\n"
         "Task: generate a close-up of the material and texture of the {product_type} in the EXACT "
         "colour shown in IMAGES 2+. Critical: match the precise shade, not your idea of '{color}'. "
         "Reproduce the lighting style from IMAGE 1 with the colour from IMAGES 2+. Focus clearly on "
         "fabric texture and details."),
}


# --- Higgsfield image generation ---
@app.route('/api/higgsfield', methods=['POST'])
def higgsfield_generate():
    data         = request.json
    # Support both legacy single URL and new multi-image list
    image_urls   = data.get('image_urls', [])
    legacy_url   = data.get('image_url')
    if legacy_url and not image_urls:
        image_urls = [legacy_url]

    prompt_type  = data.get('prompt_type', 0)   # 1-5 = Nano Banana template, 0 = custom
    product_type = data.get('product_type', 'fashion product')
    color        = data.get('color', '')
    count        = data.get('count', 4)          # default 4 (Unlimited mode)

    # Build prompt from template or use custom
    if prompt_type and prompt_type in NANO_BANANA_PROMPTS:
        prompt = NANO_BANANA_PROMPTS[prompt_type].format(
            product_type=product_type,
            color=color,
        )
    else:
        prompt = data.get('prompt', 'fashion product photo, realistic woman model, professional lighting')

    import re as _re, concurrent.futures as _cf

    def _extract_urls_from_text(text):
        """Find all image URLs in a string (plain text or JSON)."""
        return _re.findall(
            r'https?://[^\s\'"<>\]]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s\'"<>\]]*)?',
            text, _re.IGNORECASE
        )

    def _extract_urls_from_obj(obj, found=None):
        """Recursively find image URLs in a parsed JSON object."""
        if found is None:
            found = []
        if isinstance(obj, str):
            if obj.startswith('http') and any(obj.lower().endswith(e) for e in ['.jpg','.jpeg','.png','.webp']):
                found.append(obj)
            elif obj.startswith('http') and any(k in obj for k in ('cdn','storage','higgsfield','output')):
                found.append(obj)
        elif isinstance(obj, list):
            for item in obj:
                _extract_urls_from_obj(item, found)
        elif isinstance(obj, dict):
            # Only look in clearly output-specific keys (avoids picking up input_images / images)
            for key in ('output_url', 'download_url', 'signed_url', 'result_url'):
                if key in obj and isinstance(obj[key], str) and obj[key].startswith('http'):
                    found.append(obj[key])
            for key in ('output_images', 'output_urls', 'outputs', 'results'):
                if key in obj:
                    _extract_urls_from_obj(obj[key], found)
            # Also check 'url'/'src' only if NOT inside an input-related parent
            for key in ('url', 'src', 'uri', 'image_url'):
                if key in obj and isinstance(obj[key], str) and obj[key].startswith('http'):
                    found.append(obj[key])
            # Recurse into jobs/items but skip known input keys
            for key in ('jobs', 'items'):
                if key in obj:
                    _extract_urls_from_obj(obj[key], found)
        return found

    def _urls_from_stdout(text):
        """Extract image URLs from hf.exe stdout — JSON first (structured), regex as fallback."""
        # Try JSON parsing from last line backwards (avoids picking up log/progress URLs)
        for line in reversed(text.splitlines()):
            line = line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
                urls = _extract_urls_from_obj(parsed)
                if urls:
                    return urls
            except Exception:
                continue
        # Fallback: regex (may catch log messages, but better than nothing)
        return _extract_urls_from_text(text)
        for line in reversed(text.splitlines()):
            line = line.strip()
            if not line:
                continue
            try:
                return _extract_urls_from_obj(json.loads(line))
            except Exception:
                continue
        return []

    tmp_dir = None
    try:
        tmp_dir = tempfile.mkdtemp()

        # Download reference images as local files (hf.exe auto-uploads them)
        local_paths = []
        for i, url in enumerate(image_urls[:4]):
            img_path = os.path.join(tmp_dir, f'ref_{i}.jpg')
            try:
                r = req.get(url, timeout=15, headers={'User-Agent': 'Mozilla/5.0'})
                r.raise_for_status()
                with open(img_path, 'wb') as f:
                    f.write(r.content)
                local_paths.append(img_path)
            except Exception:
                pass

        if not HIGGSFIELD_EXE or not os.path.isfile(HIGGSFIELD_EXE):
            return jsonify({'error': 'Higgsfield CLI binary not found on server. '
                                     'Install with: npm install -g @higgsfield/cli'}), 500

        safe_prompt = prompt.replace('"', "'")
        base_cmd = (f'"{HIGGSFIELD_EXE}" generate create nano_banana_2'
                    f' --prompt "{safe_prompt}" --aspect_ratio 3:4 --wait --json')
        for path in local_paths:
            base_cmd += f' --image "{path}"'

        # Each job produces exactly 1 output image → run `count` jobs to get `count` results
        num_jobs = count

        def _run(_):
            r = subprocess.run(base_cmd, capture_output=True, text=True, timeout=300, shell=True)
            return r.stdout.strip(), r.stderr.strip()

        all_urls, errors = [], []
        with _cf.ThreadPoolExecutor(max_workers=num_jobs) as pool:
            for stdout_i, stderr_i in pool.map(_run, range(num_jobs)):
                if stdout_i:
                    urls_i = _urls_from_stdout(stdout_i)
                    # Higgsfield output-CDN: d8j0ntlcm91z4.cloudfront.net met hf_ prefix
                    # Input-CDN: d2ol7oe51mr4n9.cloudfront.net (altijd weggooien)
                    OUTPUT_CDN = 'd8j0ntlcm91z4.cloudfront.net'
                    filtered = [u for u in urls_i if OUTPUT_CDN in u]
                    print(f'[hf] URLs found: {urls_i}')
                    print(f'[hf] After CDN filter (output only): {filtered}')
                    if filtered:
                        all_urls.extend(filtered)
                    else:
                        errors.append(f'No output URL in job: {urls_i}')
                else:
                    errors.append(stderr_i[:200] or 'Empty output')

        if not all_urls:
            return jsonify({'error': '; '.join(errors[:2]) or 'No images received from Higgsfield',
                            'cmd': base_cmd}), 500

        # Filter by original URL set (exact + without query params)
        def _base_url(u):
            return u.split('?')[0].split('#')[0].rstrip('/')
        input_bases = {_base_url(u) for u in image_urls}
        all_urls = [u for u in all_urls if _base_url(u) not in input_bases]
        print(f'[hf] na URL-filter: {all_urls}')

        # Deduplicate, then cap at requested count
        seen = set()
        all_urls = [u for u in all_urls if not (u in seen or seen.add(u))]
        all_urls = all_urls[:count]
        return jsonify({'urls': all_urls, 'prompt_used': prompt})

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Higgsfield timeout — please try again'}), 504
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)


# --- Auto-update ---
GITHUB_RAW = os.getenv('GITHUB_RAW', '').rstrip('/')
# e.g. https://raw.githubusercontent.com/yourname/vionna-dashboard/main

VERSION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'version.txt')

def _read_local_version():
    try:
        return open(VERSION_FILE).read().strip()
    except Exception:
        return '0.0.0'

def _version_tuple(v):
    try:
        return tuple(int(x) for x in v.strip().split('.'))
    except Exception:
        return (0, 0, 0)

@app.route('/api/version')
def api_version():
    local = _read_local_version()
    if not GITHUB_RAW:
        return jsonify({'local': local, 'remote': None, 'update_available': False})
    try:
        # Files moved to backend/ subdirectory after repo restructure
        r = req.get(f'{GITHUB_RAW}/backend/version.txt', timeout=5)
        remote = r.text.strip()
        update_available = _version_tuple(remote) > _version_tuple(local)
        return jsonify({'local': local, 'remote': remote, 'update_available': update_available})
    except Exception as e:
        return jsonify({'local': local, 'remote': None, 'update_available': False, 'error': str(e)})

@app.route('/api/update', methods=['POST'])
def api_update():
    if not GITHUB_RAW:
        return jsonify({'error': 'GITHUB_RAW not configured'}), 400
    base_dir = os.path.dirname(os.path.abspath(__file__))
    # Pull from backend/ on GitHub, save locally next to the running server.py
    files_to_update = ['index.html', 'server.py', 'version.txt']
    updated = []
    errors  = []
    for fname in files_to_update:
        try:
            r = req.get(f'{GITHUB_RAW}/backend/{fname}', timeout=15)
            r.raise_for_status()
            dest = os.path.join(base_dir, fname)
            with open(dest, 'wb') as f:
                f.write(r.content)
            updated.append(fname)
        except Exception as e:
            errors.append(f'{fname}: {e}')

    if errors:
        return jsonify({'success': False, 'updated': updated, 'errors': errors}), 500

    # Schedule restart after response is sent
    def _restart():
        import time, subprocess
        time.sleep(1.5)
        subprocess.Popen([sys.executable] + sys.argv)
        os._exit(0)

    import threading
    threading.Thread(target=_restart, daemon=True).start()
    return jsonify({'success': True, 'updated': updated, 'restarting': True})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"\nVionna Dashboard running on http://localhost:{port}\n")
    app.run(debug=False, host='0.0.0.0', port=port)
