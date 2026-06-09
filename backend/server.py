import os, sys, json, re, hashlib, hmac, base64, urllib.parse, subprocess, tempfile, shutil, platform, unicodedata, datetime, time
from functools import wraps
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
CORS(app, resources={r'/api/*': {'origins': [o for o in _allowed_origins if o]}}, supports_credentials=True,
     allow_headers=['Content-Type', 'X-Droplet-Token'])

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
    'fi': {
        'client_id':     os.getenv('SHOPIFY_FI_CLIENT_ID'),
        'client_secret': os.getenv('SHOPIFY_FI_CLIENT_SECRET'),
    },
}

STORES = {
    'dk': os.getenv('SHOPIFY_DK_DOMAIN'),
    'fr': os.getenv('SHOPIFY_FR_DOMAIN'),
    'fi': os.getenv('SHOPIFY_FI_DOMAIN'),
}

# Per-store localization. Used by AI content prompts (language), price normalisation
# (psychological suffix), and product creation (size-option label in local language).
STORE_LANGUAGE     = {'dk': 'Deens',     'fr': 'Frans',  'fi': 'Fins'}
STORE_PRICE_SUFFIX = {'dk': '.95',       'fr': '.99',    'fi': '.99'}
STORE_SIZE_OPTION  = {'dk': 'Størrelse', 'fr': 'Taille', 'fi': 'Koko'}

# Append-only publish log — every successful create_variant call gets one entry.
# We use a JSON-lines file rather than a database so it's trivial to inspect on the droplet.
HISTORY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'publish_history.jsonl')

# Per-user draft storage. Each employee's auto-save state lives in `drafts/<email>.json`
# so drafts survive cross-device (any browser they log into).
DRAFTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'drafts')
os.makedirs(DRAFTS_DIR, exist_ok=True)

# Bug-report intake. Employees use the "Report a bug" button in the header;
# entries get appended to a JSONL queue + (if attached) a screenshot saved
# alongside. The CEO's Claude Code session reads the queue on session start.
BUG_REPORTS_PATH      = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bug_reports.jsonl')
BUG_SCREENSHOTS_DIR   = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bug_screenshots')
os.makedirs(BUG_SCREENSHOTS_DIR, exist_ok=True)

# --- Automatic local backups (#9) ---
# The droplet's data files (publish history, bug reports, drafts) live only on
# the droplet. A daily in-process thread snapshots them to backups/<date>/ with
# 14-day rotation — protects against accidental deletion / a bad write. (For
# off-droplet safety, the dashboard also offers a manual data export, and these
# could be shipped off-box via a cron later.) Runs in-process so it deploys with
# a plain `git pull` — no extra systemd unit needed.
_BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
BACKUP_DIR   = os.path.join(_BASE_DIR, 'backups')
_BACKUP_KEEP = 14


def _run_backup():
    """Snapshot the data files into backups/<YYYY-MM-DD>/. Returns the dir or None."""
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        day  = time.strftime('%Y-%m-%d')
        dest = os.path.join(BACKUP_DIR, day)
        os.makedirs(dest, exist_ok=True)
        for fname in ('publish_history.jsonl', 'bug_reports.jsonl'):
            src = os.path.join(_BASE_DIR, fname)
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(dest, fname))
        if os.path.isdir(DRAFTS_DIR):
            shutil.copytree(DRAFTS_DIR, os.path.join(dest, 'drafts'), dirs_exist_ok=True)
        # Rotation: keep only the most recent _BACKUP_KEEP day-folders.
        days = sorted(d for d in os.listdir(BACKUP_DIR)
                      if os.path.isdir(os.path.join(BACKUP_DIR, d)))
        for old in days[:-_BACKUP_KEEP]:
            shutil.rmtree(os.path.join(BACKUP_DIR, old), ignore_errors=True)
        return dest
    except Exception as e:
        print(f"[backup] error: {e}")
        return None


def _backup_loop():
    while True:
        _run_backup()
        time.sleep(24 * 3600)


# Start the daily backup thread once (a snapshot runs immediately on boot too).
try:
    import threading as _threading
    _threading.Thread(target=_backup_loop, daemon=True, name='daily-backup').start()
except Exception as _e:
    print(f"[backup] could not start backup thread: {_e}")

# Slack webhook for bug-report pings. Stored in a gitignored file (the repo is
# public, so the secret can't live in code/env-in-repo). Set once via
# POST /api/config/slack_webhook. Falls back to the SLACK_WEBHOOK_URL env var.
SLACK_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'slack_config.json')

def _slack_webhook_url():
    env = os.getenv('SLACK_WEBHOOK_URL')
    if env:
        return env.strip()
    try:
        with open(SLACK_CONFIG_PATH, encoding='utf-8') as f:
            return (json.load(f).get('bug_webhook') or '').strip() or None
    except Exception:
        return None

# Scopes the dashboard needs from Shopify. After changing this list, every
# already-authorised store needs to re-grant — visit /auth/dk, /auth/fr, /auth/fi
# once to issue a fresh token with the new scopes. publications scopes are
# required for the GraphQL `publishablePublish` mutation that links each
# created product to Online Store / Facebook / Google sales channels.
# Themes/translations/content/files/inventory/markets/locales added for the FI
# store cloning project (need to write themes, translations, pages, etc).
SCOPES      = ('write_products,read_products,'
               'write_inventory,read_inventory,'
               'write_product_listings,read_product_listings,'
               'read_publications,write_publications,'
               'write_files,read_files,'
               'write_themes,read_themes,'
               'write_translations,read_translations,'
               'write_content,read_content,'
               'write_shipping,read_shipping,'
               'write_markets,read_markets,'
               'write_locales,read_locales,'
               'write_metaobjects,read_metaobjects,'
               'read_orders')
# APP_URL env var should be set on Railway to https://your-app.up.railway.app
_APP_URL    = os.getenv('APP_URL', 'http://localhost:5000').rstrip('/')
REDIRECT_URI = f'{_APP_URL}/callback'
API_VERSION  = '2024-10'

# --- Token storage ---
# Tokens are stored in tokens.json locally and can be bootstrapped
# from env vars on Railway (SHOPIFY_DK_TOKEN / SHOPIFY_FR_TOKEN / SHOPIFY_FI_TOKEN).
TOKENS_FILE = 'tokens.json'
tokens = {}
if os.path.exists(TOKENS_FILE):
    try:
        with open(TOKENS_FILE) as f:
            tokens = json.load(f)
    except Exception:
        pass

# Also load from environment variables (works on Railway where filesystem is ephemeral)
for _store_key, _env_key in [('dk', 'SHOPIFY_DK_TOKEN'), ('fr', 'SHOPIFY_FR_TOKEN'), ('fi', 'SHOPIFY_FI_TOKEN')]:
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


# --- Mutation gate (short-lived signed token) ---
# The mutation endpoints (publish / backfill) write to the LIVE stores, so they
# can't be left open on the public droplet URL. The Next.js frontend mints a
# short-lived HS256 token server-side — the secret never reaches the browser —
# and the browser sends it as the `X-Droplet-Token` header. We verify it here
# using only the standard library (hmac/hashlib/base64), so no new pip dependency
# is introduced and the self-updater (which only pulls server.py + version.txt)
# keeps working. When DROPLET_TOKEN_SECRET is unset the gate is OPEN, so the first
# deploy never breaks; set the SAME secret on the droplet AND on Netlify to
# activate it (set Netlify first, then the droplet — see CLAUDE.md).
DROPLET_TOKEN_SECRET = os.getenv('DROPLET_TOKEN_SECRET')

def _b64url_decode(seg):
    return base64.urlsafe_b64decode(seg + '=' * (-len(seg) % 4))

def _verify_droplet_token(token):
    """Return the decoded payload for a valid, unexpired HS256 token, else None."""
    if not token or token.count('.') != 2 or not DROPLET_TOKEN_SECRET:
        return None
    header_b64, payload_b64, sig_b64 = token.split('.')
    signing_input = f'{header_b64}.{payload_b64}'.encode()
    try:
        expected = hmac.new(DROPLET_TOKEN_SECRET.encode(), signing_input, hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64url_decode(sig_b64)):
            return None
        payload = json.loads(_b64url_decode(payload_b64))
    except Exception:
        return None
    exp = payload.get('exp')
    if exp is not None and time.time() > float(exp):
        return None
    return payload

def require_droplet_token(f):
    """Gate a route behind a valid frontend-minted token (no-op until the secret
    is configured, so deploys are safe before the env var is set everywhere)."""
    @wraps(f)
    def _wrapped(*args, **kwargs):
        if DROPLET_TOKEN_SECRET:
            if not _verify_droplet_token(request.headers.get('X-Droplet-Token', '')):
                return jsonify({'error': 'Unauthorized — missing, invalid or expired session token'}), 401
        return f(*args, **kwargs)
    return _wrapped


# --- Static files ---
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


def _current_redirect_uri():
    """Build the OAuth callback URI from the live request so the same code
    works on localhost (dev) AND on the droplet (prod) without needing APP_URL
    to be set in the environment. Falls back to the build-time REDIRECT_URI
    if we're somehow called outside a request context."""
    try:
        host = (request.host_url or '').rstrip('/')
        if host:
            # If we're behind Caddy (droplet) the external scheme is https even
            # though Werkzeug sees http — respect the X-Forwarded-Proto header.
            xfp = request.headers.get('X-Forwarded-Proto')
            if xfp == 'https' and host.startswith('http://'):
                host = 'https://' + host[len('http://'):]
            return host + '/callback'
    except Exception:
        pass
    return REDIRECT_URI


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
    session['redirect_uri'] = _current_redirect_uri()  # remembered for /callback
    params = urllib.parse.urlencode({
        'client_id':    creds['client_id'],
        'scope':        SCOPES,
        'redirect_uri': session['redirect_uri'],
        'state':        state,
    })
    return redirect(f"https://{shop}/admin/oauth/authorize?{params}")

@app.route('/callback')
def callback():
    code      = request.args.get('code')
    shop      = request.args.get('shop')
    state     = request.args.get('state')
    store_key = session.get('store_key')

    # Fallback: derive store_key from shop domain (needed when OAuth is
    # initiated directly without going through /auth/<key>, e.g. by a
    # bot/automation that can't navigate to localhost first).
    if not store_key:
        for k, s in STORES.items():
            if s == shop:
                store_key = k
                break
    if not store_key:
        return f'Unknown shop: {shop}', 400

    # State check: only enforced when session has a state we set ourselves.
    # Direct/automation OAuth flows skip this — they don't have CSRF risk
    # because there's no logged-in user being phished.
    session_state = session.get('oauth_state')
    if session_state and state != session_state:
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
        'fi': 'fi' in tokens,
        'anthropic': bool(ANTHROPIC_KEY and ANTHROPIC_KEY != 'VOELINJEYHIER'),
    })


@app.route('/api/health')
def health():
    """System health for the admin panel (#7): version, per-store auth, Anthropic,
    Higgsfield CLI, and backup status. Non-sensitive (booleans + counts) — ungated."""
    try:
        with open(os.path.join(_BASE_DIR, 'version.txt')) as f:
            ver = f.read().strip()
    except Exception:
        ver = '?'
    last_backup, n_backups = '', 0
    if os.path.isdir(BACKUP_DIR):
        days = sorted(d for d in os.listdir(BACKUP_DIR)
                      if os.path.isdir(os.path.join(BACKUP_DIR, d)))
        n_backups = len(days)
        last_backup = days[-1] if days else ''
    return jsonify({
        'version': ver,
        'stores': {k: (k in tokens) for k in ('dk', 'fr', 'fi')},
        'anthropic': bool(ANTHROPIC_KEY and ANTHROPIC_KEY != 'VOELINJEYHIER'),
        'higgsfield_cli': bool(HIGGSFIELD_EXE),
        'backups': {'count': n_backups, 'last': last_backup},
    })


@app.route('/api/classify_shipping')
def classify_shipping():
    """Classify the source store of a product URL as dropshipper / own-stock /
    unknown, by parsing its shipping policy. Used at the import step to warn when
    the source isn't a dropshipper. Fast mode: HTTP paths + text-LLM, no browser.

    Returns: { label, detail: 'X-Yd', source, confidence }. source ∈ structured/
    policy/llm/llm-sonnet/vision/none; confidence ∈ high/medium/low/none."""
    url = (request.args.get('url') or '').strip()
    if not url:
        return jsonify({'label': 'Onbekend', 'detail': '', 'source': 'none', 'confidence': 'none'})
    try:
        from shipping_check import classify_detailed
        d = classify_detailed(url, skip_browser=True)
    except Exception as e:
        print(f"[classify_shipping] error for {url}: {e}")
        # Treat failures as 'Onbekend' so the import step can still warn (per user choice)
        return jsonify({'label': 'Onbekend', 'detail': '', 'source': 'none', 'confidence': 'none', 'error': str(e)[:200]})
    return jsonify({'label': d['label'], 'detail': d['detail'],
                    'source': d['source'], 'confidence': d['confidence']})


@app.route('/api/verify_products', methods=['POST'])
def verify_products():
    """Post-publish verification: re-read freshly created products and confirm
    images attached / cutline set / on sales channels / variants present.
    Body: { store, product_ids: [..] }. Returns per-product checks + issues.
    Also reused by the catalog-audit panel."""
    data = request.json or {}
    store = data.get('store', 'dk')
    ids = data.get('product_ids') or []
    if store not in tokens:
        return jsonify({'error': f'Not authenticated for {store.upper()} store.'}), 401
    if not ids:
        return jsonify({'products': []})
    hdrs = shopify_headers(store)
    # Coerce each id to digits only (ids come from the client) — prevents a crafted
    # value from breaking the GraphQL string, and drops malformed ids cleanly.
    gids = []
    for i in ids:
        num = re.sub(r'\D', '', str(i).rsplit('/', 1)[-1])
        if num:
            gids.append(f'gid://shopify/Product/{num}')
    if not gids:
        return jsonify({'products': []})

    out = []
    # GraphQL nodes() caps at ~250; chunk to be safe
    for i in range(0, len(gids), 100):
        chunk = gids[i:i + 100]
        id_list = ', '.join(f'"{g}"' for g in chunk)
        query = (
            '{ nodes(ids: [%s]) { ... on Product { '
            'id title status '
            'images(first: 30) { nodes { id } } '
            'cutline: metafield(namespace:"theme", key:"cutline") { value } '
            'siblings: metafield(namespace:"theme", key:"siblings") { value } '
            'resourcePublicationsCount(onlyPublished: true) { count } '
            'variantsCount { count } } } }' % id_list
        )
        try:
            r = req.post(shopify_url(store, 'graphql.json'), headers=hdrs, json={'query': query}, timeout=30)
            nodes = (r.json().get('data') or {}).get('nodes') or []
        except Exception as e:
            print(f"[verify_products] error: {e}")
            nodes = []
        for n in nodes:
            if not n:
                continue
            n_images   = len((n.get('images') or {}).get('nodes') or [])
            cutline_val = ((n.get('cutline') or {}) or {}).get('value') or ''
            siblings_v  = ((n.get('siblings') or {}) or {}).get('value') or ''
            channels    = ((n.get('resourcePublicationsCount') or {}) or {}).get('count') or 0
            variants    = ((n.get('variantsCount') or {}) or {}).get('count') or 0
            issues = []
            if n_images == 0:
                issues.append({'level': 'fail', 'msg': 'No images attached'})
            if not cutline_val.strip():
                issues.append({'level': 'warn', 'msg': 'No cutline (colour swatch)'})
            if not siblings_v.strip():
                issues.append({'level': 'warn', 'msg': 'Siblings link missing'})
            if channels == 0:
                issues.append({'level': 'warn', 'msg': 'Not on any sales channel'})
            if variants == 0:
                issues.append({'level': 'fail', 'msg': 'No variants'})
            out.append({
                'id': n.get('id', '').rsplit('/', 1)[-1],
                'title': n.get('title', ''),
                'status': n.get('status', ''),
                'images': n_images, 'cutline': cutline_val,
                'channels': channels, 'variants': variants,
                'issues': issues,
            })
    return jsonify({'products': out})


@app.route('/api/backup_now', methods=['POST'])
@require_droplet_token
def backup_now():
    """Trigger an on-demand local backup snapshot (#9)."""
    dest = _run_backup()
    return jsonify({'success': bool(dest), 'path': dest or ''})


@app.route('/api/export_data')
@require_droplet_token
def export_data():
    """Download an off-droplet backup: publish history + bug reports as one JSON.
    Gated — contains reporter emails. The dashboard fetches this and saves a file."""
    def _read_jsonl(p):
        out = []
        if os.path.exists(p):
            with open(p, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            out.append(json.loads(line))
                        except Exception:
                            pass
        return out
    return jsonify({
        'exported_at': datetime.datetime.utcnow().isoformat() + 'Z',
        'publish_history': _read_jsonl(HISTORY_PATH),
        'bug_reports': _read_jsonl(BUG_REPORTS_PATH),
    })


# --- Scrape competitor product (server-side, geen CORS) ---
_COLOR_OPT_RE = re.compile(r'colou?r|kleur|farve|couleur|colore', re.I)
_SIZE_OPT_RE  = re.compile(r'size|maat|taille|størrelse|talla', re.I)

# Handle-token classifiers used to derive a colour from a product handle when
# the product itself has no Color option (e.g. meshki.co.uk where the variants
# are split per-colour as separate products and the only option is "SIZE").
_HANDLE_NOISE_WORDS = re.compile(
    r'^(dress|top|skirt|blouse|coat|jacket|shirt|pants|jeans|mini|maxi|midi|'
    r'womens?|men|mens|kids?|lace|satin|silk|cotton|linen|long|short|'
    r'sleeve|sleeveless|knit|woven|with|and|the|of|for|new|sale)$', re.I
)
_HANDLE_COLOR_MODIFIER = re.compile(
    r'^(light|dark|deep|bright|hot|baby|dusty|royal|navy|forest|burnt|rose|ice|'
    r'pastel|neon|soft|warm|cool|pale)$', re.I
)


def _derive_color_from_handle(handle):
    """Extract a colour name from a product handle when there's no Color
    option. Mirrors the frontend's extractColors fallback so backend +
    frontend agree on what counts as 'the colour' for sibling discovery."""
    if not handle:
        return None
    tokens = [
        t for t in handle.split('-')
        if len(t) > 1 and not _HANDLE_NOISE_WORDS.match(t) and not t.isdigit()
    ]
    if not tokens:
        return None
    last = tokens[-1]
    # Two-word colours: "royal-blue", "dusty-pink", "light-grey"
    if len(tokens) >= 2 and _HANDLE_COLOR_MODIFIER.match(tokens[-2]):
        return f'{tokens[-2].capitalize()} {last.capitalize()}'
    return last.capitalize()


def _ensure_color_option(product):
    """If a product has no Color option, synthesize one from the handle suffix
    and inject it as option1 + variant.option1. Idempotent — no-op if a Color
    option already exists. Used so the sibling-merge logic works the same on
    'one-product-per-colour' shops that don't declare Color in their .json
    (meshki.co.uk et al.)."""
    if not isinstance(product, dict):
        return product
    opts = product.get('options') or []
    if any(_COLOR_OPT_RE.search(o.get('name', '') or '') for o in opts):
        return product
    derived = _derive_color_from_handle(product.get('handle', ''))
    if not derived:
        return product

    # Build the new options list with Color first.
    new_opts = [{'name': 'Color', 'position': 1, 'values': [derived]}]
    for o in opts:
        new_opts.append({**o, 'position': (o.get('position') or 1) + 1})
    product['options'] = new_opts

    # Re-slot every variant so option1 = colour, option2 = whatever option1
    # used to be (typically size). Preserves option3 as None.
    for v in product.get('variants') or []:
        old1 = v.get('option1')
        old2 = v.get('option2')
        v['option1'] = derived
        v['option2'] = old1 if old1 is not None else old2
        v['option3'] = None
    return product

# Some Shopify stores (e.g. rosamae.co.uk) enable Bot Protection that blocks
# every UA starting with "Mozilla/" while letting non-browser UAs through.
# We default to an explicit dashboard UA so those stores work out of the box,
# and only fall back to Mozilla if the first try returns a 403 (some other
# stores might preferentially serve Mozilla — covers both cases without
# burning two requests on the happy path).
_SCRAPE_UA_PRIMARY  = 'VionnaProductDashboard/1.0 (+https://vionna-dashboard.netlify.app)'
_SCRAPE_UA_FALLBACK = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'


def _scrape_get(url, timeout=10, _retries_remaining=2):
    """GET a competitor URL with UA-fallback AND retry-on-transient.

    Retries (up to 2 extra attempts with 1s + 3s backoff) on:
      - Connection errors / read timeouts
      - 429 Too Many Requests (respects Retry-After header)
      - 5xx server errors (transient outages, deploys, restarts)

    The UA fallback runs INSIDE the final-attempt path: try primary UA, if 403
    try Mozilla. We don't retry 403 — that's an auth/scope decision by the
    upstream, not a transient flake.
    """
    delays_left = [1, 3]  # seconds before each retry; popped front-first
    headers_primary  = {'User-Agent': _SCRAPE_UA_PRIMARY,
                        'Accept': 'application/json, text/html;q=0.9, */*;q=0.5'}
    headers_fallback = {'User-Agent': _SCRAPE_UA_FALLBACK,
                        'Accept': 'application/json, text/html;q=0.9, */*;q=0.5'}

    last_exc = None
    while True:
        try:
            r = req.get(url, timeout=timeout, headers=headers_primary)
            if r.status_code == 403:
                # Upstream actively rejected our identifier — try a browser UA.
                r = req.get(url, timeout=timeout, headers=headers_fallback)
            # Transient: retry
            if r.status_code == 429:
                wait_s = 5
                try:
                    wait_s = int(r.headers.get('Retry-After', '5'))
                except Exception:
                    pass
                if delays_left:
                    print(f"[scrape] 429 rate-limit on {url}, sleeping {wait_s}s then retrying")
                    time.sleep(min(wait_s, 30))
                    delays_left.pop(0)
                    continue
            if 500 <= r.status_code < 600 and delays_left:
                d = delays_left.pop(0)
                print(f"[scrape] {r.status_code} on {url}, retrying in {d}s")
                time.sleep(d)
                continue
            return r
        except (req.exceptions.ConnectionError, req.exceptions.Timeout) as e:
            last_exc = e
            if not delays_left:
                raise
            d = delays_left.pop(0)
            print(f"[scrape] transient {type(e).__name__} on {url}, retrying in {d}s")
            time.sleep(d)


def _extract_first_url(text):
    """Pull the first valid http(s):// URL out of arbitrary user text.

    Catches the common patterns where the input field gets polluted with
    extra text or another URL — e.g. dubble-paste, or 'Look at this https://...
    it's nice'. If no URL is found, returns the original text trimmed so
    downstream code can still produce its usual error."""
    if not text:
        return ''
    m = re.search(r"https?://[^\s\"'<>]+", text)
    return m.group(0).rstrip('.,;)') if m else text.strip()


def _looks_like_shopify_json(data):
    """Return True if `data` is the .json shape we expect from a Shopify
    storefront product endpoint. Used to detect non-Shopify URLs early so we
    can give a clear 'not a Shopify product' error instead of cryptic
    KeyErrors deeper in the pipeline."""
    if not isinstance(data, dict):
        return False
    p = data.get('product')
    return isinstance(p, dict) and ('options' in p or 'variants' in p or 'images' in p)


class _PrivateShopError(Exception):
    """Raised when a Shopify store is password-protected, in maintenance
    mode, or otherwise gating its storefront. Caught by /api/scrape so we
    can return a friendly 'this shop is private' message."""
    pass


def _detect_private_shop(response_text):
    """Return True if the response text looks like a Shopify password /
    coming-soon / private storefront page."""
    head = (response_text or '')[:8000].lower()
    return (
        'password_required' in head or
        'enter store password' in head or
        ('shop is in development mode' in head and 'shopify' in head) or
        'password-page' in head
    )


def _detect_cdn_bot_block(response_text, headers):
    """Return True if the 401/403 response looks like a generic CDN bot
    block (Cloudflare / Akamai / DataDome / Imperva) rather than a real
    Shopify password page. Different actionable message — the user can't
    'just enter the password', they need to either try a different URL or
    the shop owner needs to whitelist us."""
    head = (response_text or '')[:8000].lower()
    server = (headers.get('Server') or '').lower()
    via = (headers.get('CF-RAY') or headers.get('cf-ray') or '')
    cf_indicators = (
        'cloudflare' in server or
        'cloudflare' in head or
        'cf-ray' in head or
        bool(via) or
        'akamai' in server or
        'datadome' in head or
        'imperva' in head or
        'attention required' in head or
        'just a moment' in head or
        'challenge-form' in head
    )
    return cf_indicators


def _scrape_response_too_large(r, max_bytes=5_000_000):
    """If the upstream sends Content-Length > 5MB, refuse to read it."""
    cl = r.headers.get('Content-Length')
    if cl and cl.isdigit() and int(cl) > max_bytes:
        return int(cl)
    return 0


# E-commerce platform fingerprints. When a scrape fails we sniff the HTML to
# tell the user WHICH non-Shopify platform they hit, instead of a generic
# "not a Shopify product". Order matters — more specific markers first.
_PLATFORM_MARKERS = [
    ('Centra',        ['centra', 'data-centra', 'centraproduct', 'window.centra']),
    ('WooCommerce',   ['woocommerce', 'wp-content/plugins/woocommerce', 'wc-block', 'is-woocommerce']),
    ('BigCommerce',   ['bigcommerce', 'cdn11.bigcommerce.com', '/stencil/']),
    ('Magento',       ['mage/cookies', 'data-mage-init', 'magento_', '/static/version']),
    ('Salesforce Commerce Cloud', ['demandware', 'dwfrm_', 'dw.ac', 'sfcc']),
    ('Wix',           ['_wixcssimports', 'wix.com', 'static.wixstatic', 'wixapps']),
    ('Squarespace',   ['squarespace', 'static1.squarespace', 'sqs-block']),
    ('PrestaShop',    ['prestashop', 'data-prestashop']),
]


def _detect_platform(html_text):
    """Return a non-Shopify platform name if the HTML carries its fingerprint,
    else None. Used to give a precise 'this is a WooCommerce/Centra store, we
    only support Shopify' message instead of a confusing parse error."""
    if not html_text:
        return None
    head = html_text[:50000].lower()
    # If it's obviously Shopify, don't misfire.
    if 'cdn.shopify.com' in head or 'shopify.shop' in head or 'x-shopify' in head:
        return None
    for name, markers in _PLATFORM_MARKERS:
        if any(mk in head for mk in markers):
            return name
    return None


def _strip_color_from_title(title, color):
    """Strip a trailing ' - Color' / ' | Color' / ' Color' from a product
    title so we can compare the 'base name' of sibling products that share a
    name but differ only by colour. Returns the lowercased base name."""
    t = (title or '').strip()
    if not t:
        return ''
    # Cut at the last ' - ' or ' | ' separator (most shops use one of these)
    for sep in (' - ', ' | ', ' / ', ' – '):
        if sep in t:
            t = t.rsplit(sep, 1)[0]
            break
    else:
        # No separator — strip a trailing colour word if present
        c = (color or '').strip()
        if c and t.lower().endswith(c.lower()):
            t = t[: -len(c)].strip()
    return re.sub(r'\s+', ' ', t).strip().lower()


def _map_higgsfield_error(raw):
    """Translate Higgsfield's raw error output into a user-actionable message.
    The CLI / API doesn't have a stable error-code scheme, so we string-match
    on the most common failure modes we've seen. Falls back to a trimmed raw
    string when nothing matches."""
    if not raw:
        return 'Higgsfield returned no output.'
    low = raw.lower()
    if 'insufficient' in low and ('credit' in low or 'balance' in low):
        return 'Higgsfield account is out of credits. Top up at higgsfield.ai or wait for the daily quota to reset.'
    if 'quota' in low and ('exceed' in low or 'exhaust' in low or 'limit' in low):
        return 'Higgsfield quota exceeded for this plan. Top up or wait for the reset.'
    if 'rate limit' in low or 'too many request' in low or '429' in low:
        return 'Higgsfield rate limit reached — wait a few seconds and click Retry.'
    if 'unauthor' in low or 'invalid token' in low or 'expired' in low and 'session' in low:
        return 'Higgsfield session expired — run `hf auth login` on the server.'
    if 'timeout' in low or 'timed out' in low:
        return 'Higgsfield timed out (took too long). Try with fewer reference images or click Retry.'
    if 'image' in low and ('too large' in low or 'invalid' in low or 'unsupported' in low):
        return 'A reference image was rejected (probably too large or unsupported format). Try a different ref.'
    if 'network' in low or 'connection' in low:
        return 'Higgsfield network error — server-side connectivity issue. Click Retry.'
    return raw[:200]


def _sane_image_url(u):
    """Reject image URLs that would break downstream (Higgsfield refuses SVG /
    animated GIF, sprite-sheets are tiny icons, etc.). Belt-and-suspenders
    around the merge / scrape image lists."""
    if not isinstance(u, str):
        return False
    if not u.startswith(('http://', 'https://')):
        return False
    lower = u.lower().split('?', 1)[0]
    if lower.endswith(('.svg', '.gif')):
        return False
    if '/icons/' in lower or '/sprites/' in lower:
        return False
    return True


def _scrape_slugify(text):
    """Lowercase + diacritic-strip + dash-separated — matches how shops slug colours into handles."""
    normalized = unicodedata.normalize('NFKD', text or '')
    ascii_text = ''.join(c for c in normalized if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', '-', ascii_text.lower()).strip('-')


def _find_siblings_via_catalog(scheme, netloc, base_prefix, base_handle,
                               base_title=None, base_color=None,
                               base_product_type=None, max_pages=5):
    """Fallback sibling discovery for shops that don't embed colour-swatch
    URLs in the product page HTML (Babyboo / shops with JavaScript-driven
    pickers). Walks /products.json?page=N (cap 5 pages = 1250 products).

    Matches a candidate as a sibling when EITHER:
      (a) handle starts with `<base_prefix>-`  — primary, high precision; OR
      (b) its colour-stripped title equals the base's colour-stripped title
          AND product_type matches  — catches siblings with mismatched
          handles (e.g. base 'fenella-maxi-dress-ivory' but black variant
          lives at 'fenella-blk-2024'). The product_type guard keeps this
          from matching unrelated products that happen to share a name.

    Slower than the HTML route — only called when HTML returned nothing."""
    if not base_prefix and not base_title:
        return []
    base_title_norm = _strip_color_from_title(base_title, base_color) if base_title else ''
    base_type_norm  = (base_product_type or '').strip().lower()
    found = []
    seen = set()
    for page in range(1, max_pages + 1):
        try:
            r = _scrape_get(
                f'{scheme}://{netloc}/products.json?limit=250&page={page}',
                timeout=15,
            )
            if r.status_code != 200:
                break
            data = r.json()
        except Exception as e:
            print(f"[scrape] catalog fallback page {page} failed: {e}")
            break
        prods = data.get('products') or []
        if not prods:
            break
        for p in prods:
            h = (p.get('handle') or '').lower()
            if not h or h == base_handle or h in seen:
                continue
            match = False
            # (a) handle-prefix match
            if base_prefix and h.startswith(base_prefix + '-'):
                match = True
            # (b) title-similarity match (mismatched-handle siblings)
            elif base_title_norm:
                cand_title_norm = _strip_color_from_title(p.get('title'), None)
                if cand_title_norm and cand_title_norm == base_title_norm:
                    cand_type = (p.get('product_type') or '').strip().lower()
                    # product_type guard — only when both sides declare one
                    if not base_type_norm or not cand_type or cand_type == base_type_norm:
                        match = True
            if match:
                seen.add(h)
                found.append(h)
        if len(found) >= 20:
            break
    return sorted(found)


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
    """Fetch /products/<handle>.json and return the product dict, or None.
    Falls back to HTML+JSON-LD scraping for Shopify Plus stores that have
    disabled the public .json endpoint (e.g. SKIMS).

    Always normalises the returned product so it has a Color option (derived
    from the handle suffix when the store doesn't declare one) — needed for
    the sibling-merge to attribute images to the right colour bucket on
    'one-product-per-colour' shops like meshki.co.uk."""
    json_url = f'{scheme}://{netloc}/products/{handle}.json'
    p = None
    try:
        r = _scrape_get(json_url, timeout=10)
        if r.status_code == 404:
            p = _scrape_product_from_html(scheme, netloc, handle)
        else:
            r.raise_for_status()
            p = r.json().get('product')
    except Exception as e:
        print(f"[scrape] sibling .json failed for {handle}: {e} — trying HTML fallback")
        try:
            p = _scrape_product_from_html(scheme, netloc, handle)
        except Exception as e2:
            print(f"[scrape] HTML fallback also failed for {handle}: {e2}")
            return None
    return _ensure_color_option(p) if p else None


def _scrape_product_from_html(scheme, netloc, handle, html_text=None):
    """Build a Shopify-style product dict from the storefront HTML.

    Used for Shopify Plus stores that block /products/<handle>.json. Parses the
    embedded JSON-LD ProductGroup schema for name + variants + the offer price,
    extracts the colour from the URL handle (assumes the handle ends with -<colour>),
    and filters CDN image URLs by the productGroupID SKU prefix to find images
    that belong to THIS colour variant. The result matches the shape of a
    regular `/products/handle.json` response so downstream code (sibling merge,
    extractVariantsByColor, groupImagesByColor) can run unchanged.
    """
    if html_text is None:
        url = f'{scheme}://{netloc}/products/{handle}'
        # also handle stores that include a locale prefix (e.g. /en-nl/products/...)
        # by trying the bare path first; if it 404s the caller will have given us
        # html_text from the canonical URL anyway
        r = _scrape_get(url, timeout=10)
        r.raise_for_status()
        html_text = r.text

    # 1. Pull ALL JSON-LD blocks; pick the ProductGroup (or Product) one
    pg = None
    for m in re.finditer(r'<script[^>]*type="application/ld\+json"[^>]*>([\s\S]*?)</script>', html_text):
        try:
            obj = json.loads(m.group(1).strip())
        except Exception:
            continue
        if isinstance(obj, dict) and obj.get('@type') in ('ProductGroup', 'Product'):
            pg = obj
            break
    if not pg:
        return None

    # 2. Determine colour. Prefer the suffix on the handle; fall back to the
    #    " | COLOUR" tail in the name.
    raw_name = (pg.get('name') or '').strip()
    parts = re.split(r'\s*[\|]\s*', raw_name)
    if len(parts) >= 2:
        # SKIMS pattern: "PRODUCT NAME | COLOR" or "PRODUCT NAME | COLOR | SIZE"
        clean_title = parts[0].title()
        # Pick whichever later part is most likely the colour — skip size-shaped tokens.
        colour_guess = next(
            (p for p in parts[1:] if not re.match(r'^(X{0,4}S|M|L|X{0,4}L|XX{0,3}L|\d+)$', p.strip(), re.I)),
            parts[1],
        ).strip().title()
    else:
        clean_title = raw_name.title() or handle.replace('-', ' ').title()
        colour_guess = ''

    # If colour is empty, derive it from the handle's final segment
    if not colour_guess:
        tail = handle.rsplit('-', 1)[-1] if '-' in handle else handle
        colour_guess = tail.replace('-', ' ').title()

    # 3. Build variants from hasVariant entries
    hv = pg.get('hasVariant') or []
    if not isinstance(hv, list):
        hv = []
    variants = []
    sizes_seen = []
    for v in hv:
        if not isinstance(v, dict):
            continue
        size = (v.get('size') or '').strip()
        if not size:
            # Some variants embed size only in name: "... | SIZE"
            n = (v.get('name') or '').split('|')
            size = (n[-1].strip() if n else '') or ''
        offers = v.get('offers') or {}
        if isinstance(offers, list):
            offers = offers[0] if offers else {}
        price = offers.get('price') if isinstance(offers, dict) else None
        # Synthetic numeric variant id (the merge logic needs uniqueness, not
        # a real Shopify ID).
        mpn = v.get('mpn') or v.get('sku') or v.get('gtin') or v.get('@id') or f'{handle}-{size}'
        synthetic_id = abs(hash(mpn)) % (10 ** 14)
        if size and size not in sizes_seen:
            sizes_seen.append(size)
        variants.append({
            'id':      synthetic_id,
            'option1': colour_guess,
            'option2': size,
            'option3': None,
            'price':   str(price) if price is not None else '0.00',
            'sku':     v.get('mpn') or v.get('sku') or '',
            'featured_image': None,
        })

    # 4. Extract images. Strategy:
    #    a) Anything in the ProductGroup's `image` list, if present.
    #    b) All Shopify CDN URLs in the HTML that contain the productGroupID
    #       SKU prefix — these are guaranteed to be THIS colour's photos.
    #    c) Strip trailing backslashes (Shopify Plus sometimes serialises
    #       escaped paths).
    img_urls = []
    seen = set()
    def _add_img(u):
        if not u or not isinstance(u, str): return
        u = u.rstrip('\\').strip()
        u = u.replace('\\/', '/')
        if u in seen: return
        seen.add(u)
        img_urls.append(u)

    for src in (pg.get('image') or []):
        if isinstance(src, str):
            _add_img(src)
        elif isinstance(src, dict):
            _add_img(src.get('url') or src.get('contentUrl'))

    pgid = pg.get('productGroupID') or ''
    # Build a colour-aware SKU prefix: productGroupID + the standard variant
    # SKU pattern. SKIMS uses "<pgid>-<COLOUR_CODE>" so e.g. BT-TRI-8466W-MLN.
    # We can't reliably know the colour code, so we look for any image whose
    # filename starts with the productGroupID.
    if pgid:
        # Find all CDN images whose path contains the productGroupID
        cdn_pattern = re.compile(
            r'https://cdn\.shopify\.com/s/files/[^\s"\'<>\\]+\.(?:jpe?g|png|webp)(?:\?[^\s"\'<>\\]*)?',
            re.I,
        )
        for m in cdn_pattern.finditer(html_text):
            u = m.group(0)
            if pgid.upper() in u.upper():
                _add_img(u)

    # If we found nothing, take any image from the variant entries themselves
    if not img_urls:
        for v in hv:
            if isinstance(v, dict):
                _add_img(v.get('image'))

    # Drop URLs that Higgsfield can't handle (SVG / GIF / sprites / non-https)
    img_urls = [u for u in img_urls if _sane_image_url(u)]
    images = []
    for i, u in enumerate(img_urls, start=1):
        images.append({
            'id':          abs(hash(f'{handle}-img-{i}')) % (10 ** 14),
            'src':         u,
            'position':    i,
            'variant_ids': [],
        })

    product = {
        'id':       abs(hash(f'{handle}-product')) % (10 ** 14),
        'title':    clean_title,
        'handle':   handle,
        'options': [
            {'name': 'Color', 'position': 1, 'values': [colour_guess] if colour_guess else []},
            {'name': 'Size',  'position': 2, 'values': sizes_seen or ['XS', 'S', 'M', 'L', 'XL']},
        ],
        'variants': variants,
        'images':   images,
    }
    return product


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
            # Skip URLs that downstream tools refuse (SVG / GIF / sprites)
            if _sane_image_url(new_img.get('src')):
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
    raw_input = (request.json.get('url') or '').strip()
    # Defensive: pluck the FIRST http(s):// URL out of arbitrary user text.
    # Catches dubble-paste, surrounding chatter ("Look at this <url> nice eh?"),
    # leading whitespace, etc. Falls back to the raw text if no URL is found.
    raw = _extract_first_url(raw_input)
    if not raw or not raw.startswith(('http://', 'https://')):
        return jsonify({
            'error': 'Please paste a full product URL starting with https://.',
            'url_tried': raw_input,
        }), 400
    # Strip tracking query params / fragments — Shopify needs a clean /products/handle URL
    parsed = urllib.parse.urlparse(raw)
    clean_path = parsed.path.rstrip('/')
    # Normalisation A: collection-prefixed URLs (Shopify allows both
    # /products/x AND /collections/foo/products/x). The .json endpoint only
    # exists under /products/x — strip any collection prefix here.
    clean_path = re.sub(r'^/collections/[^/]+/products/', '/products/', clean_path)
    json_path = clean_path if clean_path.endswith('.json') else clean_path + '.json'
    html_path = clean_path[:-5] if clean_path.endswith('.json') else clean_path
    scheme   = parsed.scheme or 'https'
    json_url = urllib.parse.urlunparse((scheme, parsed.netloc, json_path, '', '', ''))
    html_url = urllib.parse.urlunparse((scheme, parsed.netloc, html_path, '', '', ''))

    # Locale-prefix fallback: many international stores use /<locale>/products/<handle>
    # (e.g. /en-us/products/x, /fr/products/y). Some shops 404 the .json under
    # the locale prefix but accept it without — keep a fallback URL ready.
    locale_match = re.match(r'^/([a-z]{2}(?:-[a-z]{2})?)(/products/.+)$', clean_path, re.I)
    json_url_nolocale = None
    html_url_nolocale = None
    if locale_match:
        nolocale_path = locale_match.group(2)
        nolocale_json = nolocale_path if nolocale_path.endswith('.json') else nolocale_path + '.json'
        nolocale_html = nolocale_path[:-5] if nolocale_path.endswith('.json') else nolocale_path
        json_url_nolocale = urllib.parse.urlunparse((scheme, parsed.netloc, nolocale_json, '', '', ''))
        html_url_nolocale = urllib.parse.urlunparse((scheme, parsed.netloc, nolocale_html, '', '', ''))

    base = None
    fallback_html = None
    scrape_path = 'json'   # diagnostics: which path produced the product
    try:
        r = _scrape_get(json_url, timeout=20)
        # Locale-prefix fallback: if the prefixed URL 404'd, retry without it.
        if r.status_code == 404 and json_url_nolocale:
            print(f"[scrape] .json 404 with locale — retrying without prefix: {json_url_nolocale}")
            r2 = _scrape_get(json_url_nolocale, timeout=20)
            if r2.status_code != 404:
                r = r2
                # Update the URLs we'll use going forward
                json_url = json_url_nolocale
                html_url = html_url_nolocale or html_url
        # Auth-rejection branch — Shopify returns 401 for real password pages
        # and various CDNs (Cloudflare / DataDome / Akamai) return 401/403
        # when they detect us as a bot. These need DIFFERENT user-facing
        # messages so the user knows whether to ask for the password or to
        # just try a different URL / wait it out.
        if r.status_code in (401, 403):
            body = r.text or ''
            if _detect_private_shop(body):
                return jsonify({
                    'error': 'This shop is password-protected or in development mode (Shopify "coming soon" gate). Ask the shop owner for storefront access.',
                    'url_tried': json_url,
                }), 400
            if _detect_cdn_bot_block(body, r.headers):
                return jsonify({
                    'error': "This shop's anti-bot protection (Cloudflare or similar) is blocking our scraper. Try a different product from this shop, or ask the shop owner to whitelist us.",
                    'url_tried': json_url,
                }), 400
            # Unknown 401/403 — generic message
            return jsonify({
                'error': f'Upstream returned {r.status_code}. The shop may be private, geo-restricted, or temporarily blocking us.',
                'url_tried': json_url,
            }), 400
        if r.status_code == 200 and _detect_private_shop(r.text or ''):
            return jsonify({
                'error': 'This shop is password-protected or in development mode (Shopify "coming soon" / "enter password" gate). Ask the shop owner for storefront access.',
                'url_tried': json_url,
            }), 400
        # Response-size cap: don't try to parse multi-MB JSON dumps (slow +
        # memory risk). Real Shopify product.json is typically <500KB.
        too_big = _scrape_response_too_large(r, max_bytes=5_000_000)
        if too_big:
            return jsonify({
                'error': f'Upstream response is too large ({too_big} bytes). This URL probably is not a single Shopify product page.',
                'url_tried': json_url,
            }), 400
        if r.status_code == 404:
            # Some Shopify Plus stores disable the public .json endpoint (e.g.
            # SKIMS). Fall back to scraping the embedded JSON-LD ProductGroup
            # from the HTML.
            print(f"[scrape] .json 404 — trying HTML fallback for {json_url}")
            html_r = _scrape_get(html_url, timeout=10)
            html_r.raise_for_status()
            fallback_html = html_r.text
            # Derive handle from the path. NB: do NOT use .rstrip('.json'),
            # rstrip operates on a CHAR SET so it would chew through letters
            # like 'on' / 'n' at the end of the handle (the SKIMS "-melon"
            # got truncated to "-mel" that way).
            path_no_json = clean_path[:-5] if clean_path.endswith('.json') else clean_path
            handle_from_path = path_no_json.rsplit('/', 1)[-1]
            base = _scrape_product_from_html(scheme, parsed.netloc, handle_from_path, html_text=fallback_html)
            scrape_path = 'html-jsonld'
            if not base:
                # Maybe it's not Shopify at all — fingerprint the platform for
                # a precise message.
                platform = _detect_platform(fallback_html)
                if platform:
                    return jsonify({
                        'error': f'This looks like a {platform} store, not Shopify. The dashboard currently only supports Shopify storefronts.',
                        'url_tried': json_url,
                    }), 400
                return jsonify({
                    'error': 'Could not extract product data from HTML (no JSON-LD ProductGroup found).',
                    'url_tried': json_url,
                }), 500
        else:
            r.raise_for_status()
            # Some shops 200 OK with HTML for unknown product paths (no
            # Shopify-style .json). Detect that early so we don't crash deeper.
            try:
                base_data = r.json()
            except Exception:
                base_data = None
            if not _looks_like_shopify_json(base_data):
                # Try the HTML fallback before giving up — covers SKIMS-style
                # Plus stores that strip the .json endpoint.
                print(f"[scrape] .json response wasn't Shopify-shaped — trying HTML fallback")
                try:
                    html_r = _scrape_get(html_url, timeout=10)
                    html_r.raise_for_status()
                    fallback_html = html_r.text
                    handle_from_path = clean_path[:-5] if clean_path.endswith('.json') else clean_path
                    handle_from_path = handle_from_path.rsplit('/', 1)[-1]
                    base = _scrape_product_from_html(scheme, parsed.netloc, handle_from_path, html_text=fallback_html)
                    if base:
                        scrape_path = 'html-jsonld'
                except Exception:
                    base = None
                if not base:
                    # Fingerprint the platform so the user knows WHY it failed.
                    platform = _detect_platform(fallback_html or '')
                    if platform:
                        return jsonify({
                            'error': f'This looks like a {platform} store, not Shopify. The dashboard currently only supports Shopify storefronts.',
                            'url_tried': json_url,
                        }), 400
                    return jsonify({
                        'error': 'This URL does not look like a Shopify product. The dashboard only supports Shopify stores.',
                        'url_tried': json_url,
                    }), 400
            else:
                base = base_data.get('product') or {}
    except Exception as e:
        return jsonify({'error': str(e), 'url_tried': json_url}), 500
    if base is None:
        base = {}

    # Make sure the base product has a Color option even if the shop only
    # exposes Size (meshki.co.uk pattern). After this, the sibling-discovery
    # code below works uniformly regardless of how the upstream shop models
    # colour.
    base = _ensure_color_option(base)

    # Sanity check: products with no variants are typically hidden / sold-out /
    # discontinued. Generation would produce something useless. Bail with a
    # clear message instead.
    if not base.get('variants'):
        return jsonify({
            'error': 'This product has no variants — it may be hidden, sold-out, or discontinued in this store. Try another URL.',
            'url_tried': json_url,
        }), 400

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
                # Reuse the HTML we already fetched if we came in via the
                # fallback path; otherwise fetch it now for sibling discovery.
                html_text = fallback_html
                if html_text is None:
                    try:
                        html_r = _scrape_get(html_url, timeout=10)
                        html_r.raise_for_status()
                        html_text = html_r.text
                    except Exception as e:
                        print(f"[scrape] HTML fetch for siblings failed: {e}")
                        html_text = ''
                sibling_handles = _find_color_sibling_handles(html_text or '', base_handle, color_slug)

                siblings_method = 'html-anchor' if sibling_handles else None

                # Catalog fallback for shops whose colour pickers don't put
                # direct /products/<sibling> links in the HTML (Babyboo et al.).
                if not sibling_handles:
                    if base_handle.endswith('-' + color_slug):
                        base_prefix = base_handle[:-(len(color_slug) + 1)]
                        if len(base_prefix) >= 3:
                            print(f"[scrape] HTML found no siblings — trying catalog fallback for prefix '{base_prefix}'")
                            sibling_handles = _find_siblings_via_catalog(
                                scheme, parsed.netloc, base_prefix, base_handle,
                                base_title=base.get('title'),
                                base_color=color_values[0] if color_values else None,
                                base_product_type=base.get('product_type'),
                            )
                            if sibling_handles:
                                siblings_method = 'catalog'
                                print(f"[scrape] Catalog fallback found {len(sibling_handles)} siblings")

                if sibling_handles:
                    print(f"[scrape] Found {len(sibling_handles)} sibling colour-products for '{base_handle}'")
                    sibs = []
                    for sh in sibling_handles[:25]:   # cap to avoid runaway fetches
                        sib_product = _fetch_product_json(scheme, parsed.netloc, sh)
                        if sib_product:
                            sibs.append(sib_product)
                    if sibs:
                        merged = _merge_sibling_color_products(base, sibs)
                        merged['_debug'] = {
                            'path': scrape_path,
                            'siblings_method': siblings_method,
                            'siblings_found': len(sibs) + 1,
                            'colors': (merged.get('options') or [{}])[0].get('values', []),
                        }
                        return jsonify({'product': merged})
    except Exception as e:
        print(f"[scrape] sibling-merge step failed (continuing with base only): {e}")

    # No siblings merged — return the single product, with diagnostics so a
    # "only saw 1 colour" bug report tells us exactly which path ran.
    base['_debug'] = {
        'path': scrape_path,
        'siblings_method': None,
        'siblings_found': 1,
        'colors': (base.get('options') or [{}])[0].get('values', []),
    }
    return jsonify({'product': base})


@app.route('/api/scrape_manual', methods=['POST'])
def scrape_manual():
    """Escape hatch for shops whose Cloudflare / WAF blocks our datacentre IP.

    The user manually fetches the /products/<handle>.json URL from their own
    browser (which works because it's coming from a residential IP), pastes the
    resulting JSON here, and we validate + normalise it the same way the
    automatic scrape path does — so the dashboard sees the same shape no matter
    which path the data came in through.

    Limitations vs the automatic scrape:
      - No sibling-discovery. Multi-colour Billy-J-style shops need one paste
        per colour, OR the user accepts publishing each colour separately.
      - No HTML JSON-LD fallback (we don't have the HTML page).
    """
    payload = request.json or {}
    raw_json = payload.get('json') or ''
    if not isinstance(raw_json, str) or not raw_json.strip():
        return jsonify({'error': 'Paste the product JSON in the `json` field of the request body.'}), 400
    try:
        parsed = json.loads(raw_json)
    except Exception as e:
        return jsonify({
            'error': f'That does not look like valid JSON ({e}). Make sure you copied the FULL response from the .json URL.',
        }), 400
    # Accept both the wrapped { "product": {...} } and the unwrapped { ... } forms
    if isinstance(parsed, dict) and 'product' in parsed:
        base = parsed.get('product') or {}
    elif isinstance(parsed, dict) and ('options' in parsed or 'variants' in parsed):
        base = parsed
    else:
        return jsonify({
            'error': 'The pasted JSON does not look like a Shopify product. It should start with {"product":{...}}.',
        }), 400
    if not _looks_like_shopify_json({'product': base}):
        return jsonify({
            'error': 'The pasted JSON is missing the expected Shopify fields (options / variants / images).',
        }), 400

    # Apply the same normalisation as the automatic path so downstream code
    # behaves identically.
    base = _ensure_color_option(base)
    if not base.get('variants'):
        return jsonify({
            'error': 'This product has no variants — likely sold-out, hidden, or discontinued.',
        }), 400
    return jsonify({'product': base, 'source': 'manual-paste'})


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


# --- Backfill: ensure every existing product is on Online Store + Facebook + Google ---

@app.route('/api/backfill_sales_channels', methods=['POST'])
@require_droplet_token
def backfill_sales_channels():
    """Walk every product in a store and (re-)publish it to the three default
    sales channels. Idempotent — products already on a channel are silently
    re-confirmed by Shopify, no duplicate publications get created.

    Usage:
      curl -X POST .../api/backfill_sales_channels?store=dk
      curl -X POST .../api/backfill_sales_channels?store=fr

    Returns a per-store summary with counts of successes / failures and any
    error messages encountered.
    """
    store = request.args.get('store', 'dk')
    if store not in tokens:
        return jsonify({'error': f'Not authenticated for {store.upper()} store.'}), 401

    hdrs = shopify_headers(store)
    pubs = _list_publications(store, hdrs)
    targets = _default_publication_targets(pubs)
    if not targets:
        return jsonify({
            'error': 'No matching publications (Online Store / Facebook / Google) found in this shop.',
            'available_publications': [p.get('name') for p in pubs],
        }), 400

    successes = 0
    failures = []
    samples_published = []

    # Paginate via the Link header — Shopify returns up to 250 per page.
    next_url = shopify_url(store, 'products.json?limit=250&fields=id,title,status&status=active,draft,archived')
    while next_url:
        try:
            r = req.get(next_url, headers=hdrs, timeout=20)
        except Exception as e:
            failures.append({'page': next_url, 'error': str(e)})
            break
        if r.status_code != 200:
            failures.append({'page': next_url, 'status': r.status_code, 'body': r.text[:200]})
            break

        products = r.json().get('products', [])
        for p in products:
            pid = p.get('id')
            if not pid:
                continue
            errs = _publish_to_default_channels(store, pid, hdrs)
            if errs:
                failures.append({'product_id': pid, 'title': p.get('title'), 'errors': errs})
            else:
                successes += 1
                if len(samples_published) < 5:
                    samples_published.append({
                        'id': pid,
                        'title': p.get('title'),
                        'status': p.get('status'),
                    })

        # Next page via Link header
        link = r.headers.get('Link') or r.headers.get('link') or ''
        m = re.search(r'<([^>]+)>;\s*rel="next"', link)
        next_url = m.group(1) if m else None

    # Pull out a representative first-failure error so the dashboard can
    # surface WHY everything blew up without forcing the user to dig into
    # the full failures list. Group by the first error message so we can
    # tell whether 1274 failures are 1 root cause or many distinct ones.
    error_summary: dict = {}
    for f in failures:
        errs = f.get('errors') or [f.get('error') or '?']
        key = (errs[0] or '?')[:200]
        error_summary[key] = error_summary.get(key, 0) + 1

    return jsonify({
        'store': store,
        'targets': [p.get('name') for p in targets],
        'successes': successes,
        'failures_count': len(failures),
        'failures': failures[:20],
        'first_failure_error': (failures[0].get('errors') or [failures[0].get('error')])[0] if failures else None,
        'error_summary': error_summary,
        'samples_published': samples_published,
    })


# --- Per-user draft storage ---

def _sanitize_owner(raw):
    """Map an email-ish identifier to a filesystem-safe filename. Strips anything
    outside [a-z0-9._@-] and truncates to 100 chars — keeps the email recognisable
    in the drafts/ folder while preventing path-traversal."""
    s = (raw or '').strip().lower()
    s = re.sub(r'[^a-z0-9._@\-]', '', s)
    return s[:100]


def _draft_path(owner_slug):
    return os.path.join(DRAFTS_DIR, f'{owner_slug}.json')


@app.route('/api/drafts', methods=['GET'])
def drafts_load():
    """Return the saved draft for `?owner=<email>`, or 404 if none exists.

    Auth model: the frontend's Next.js layout has already gated this — we accept
    the email as a query param. For an internal tool with 2-3 users it's fine
    that the backend trusts the value (matches the trust model of the rest of
    /api/*).
    """
    owner = _sanitize_owner(request.args.get('owner', ''))
    if not owner:
        return jsonify({'error': 'owner query param required'}), 400
    path = _draft_path(owner)
    if not os.path.exists(path):
        return jsonify({'draft': None})
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify({'draft': data, 'saved_at': data.get('_saved_at')})
    except Exception as e:
        return jsonify({'error': f'Could not read draft: {e}'}), 500


@app.route('/api/drafts', methods=['POST'])
def drafts_save():
    """Save the JSON body as the draft for `?owner=<email>`."""
    owner = _sanitize_owner(request.args.get('owner', ''))
    if not owner:
        return jsonify({'error': 'owner query param required'}), 400
    payload = request.json or {}
    if not isinstance(payload, dict):
        return jsonify({'error': 'expected a JSON object body'}), 400
    payload['_saved_at'] = datetime.datetime.utcnow().isoformat() + 'Z'
    path = _draft_path(owner)
    try:
        # Atomic write: temp file then rename
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception as e:
        return jsonify({'error': f'Could not save draft: {e}'}), 500
    return jsonify({'success': True, 'saved_at': payload['_saved_at']})


@app.route('/api/drafts/debug', methods=['GET'])
def drafts_debug():
    """Inspect what's actually in a saved draft without exposing PII / image URLs.
    Returns shape + counts of each major field — useful for diagnosing
    'photos went missing after Resume' type issues.
    """
    owner = _sanitize_owner(request.args.get('owner', ''))
    if not owner:
        # No owner = list every draft on the droplet
        try:
            files = sorted(os.listdir(DRAFTS_DIR))
            info = []
            for f in files:
                if not f.endswith('.json'):
                    continue
                path = os.path.join(DRAFTS_DIR, f)
                try:
                    info.append({
                        'owner': f[:-5],
                        'size_bytes': os.path.getsize(path),
                        'mtime': datetime.datetime.fromtimestamp(os.path.getmtime(path)).isoformat() + 'Z',
                    })
                except Exception:
                    pass
            return jsonify({'drafts': info})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    path = _draft_path(owner)
    if not os.path.exists(path):
        return jsonify({'owner': owner, 'exists': False})
    try:
        size = os.path.getsize(path)
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        def count_list(x):
            if isinstance(x, list):
                return len(x)
            return None

        def count_record(x):
            if isinstance(x, dict):
                return {str(k): count_list(v) for k, v in x.items()}
            return None

        summary = {
            'owner':              owner,
            'exists':             True,
            'size_bytes':         size,
            'saved_at':           data.get('_saved_at'),
            'fields_present':     sorted([k for k in data.keys() if k != '_saved_at']),
            # counts of the things that matter for "where did my photos go"
            'name':               data.get('name'),
            'competitorUrl':      bool(data.get('competitorUrl')),
            'canonical_colors':   data.get('canonicalColors'),
            'selected_stores':    data.get('selectedStores'),
            'nb_results':         count_record(data.get('nbResults')),
            'nb_results_per_color': count_record(data.get('nbResultsPerColor')),
            'publish_pool_size':  count_list(data.get('publishPool')),
            'publish_pool_selected': sum(1 for p in (data.get('publishPool') or []) if isinstance(p, dict) and p.get('selected')),
            'competitor_images':  count_list(data.get('competitorImages')),
            'competitor_images_by_color': count_record(data.get('competitorImagesByColor')),
            'pinned_url_set':     bool(data.get('pinnedUrl')),
        }
        return jsonify(summary)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/drafts', methods=['DELETE'])
def drafts_clear():
    """Delete the saved draft for `?owner=<email>`."""
    owner = _sanitize_owner(request.args.get('owner', ''))
    if not owner:
        return jsonify({'error': 'owner query param required'}), 400
    path = _draft_path(owner)
    if os.path.exists(path):
        try:
            os.remove(path)
        except Exception as e:
            return jsonify({'error': f'Could not clear draft: {e}'}), 500
    return jsonify({'success': True})


# --- Bug-report intake (queued for CEO's Claude Code session) ---

import base64 as _b64

def _next_bug_id():
    """Find the highest ID currently in bug_reports.jsonl and return +1."""
    if not os.path.exists(BUG_REPORTS_PATH):
        return 1
    highest = 0
    try:
        with open(BUG_REPORTS_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    e = json.loads(line)
                    if isinstance(e, dict) and isinstance(e.get('id'), int):
                        highest = max(highest, e['id'])
                except Exception:
                    pass
    except Exception:
        return 1
    return highest + 1


def _load_bug_reports(status_filter=None):
    """Read bug_reports.jsonl as a list. Filters out resolved entries when
    status_filter='open'. Latest-first ordering."""
    if not os.path.exists(BUG_REPORTS_PATH):
        return []
    out = []
    try:
        with open(BUG_REPORTS_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    e = json.loads(line)
                except Exception:
                    continue
                if not isinstance(e, dict):
                    continue
                if status_filter and e.get('status') != status_filter:
                    continue
                out.append(e)
    except Exception as ex:
        print(f"[bugs] load failed: {ex}")
    out.sort(key=lambda e: e.get('id', 0), reverse=True)
    return out


def _rewrite_bug_reports(entries):
    """Atomically replace bug_reports.jsonl with `entries`. Used by status
    updates since we can't easily edit a single line in JSONL in place."""
    tmp = BUG_REPORTS_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        # Write oldest first so append-only semantics still hold visually
        for e in sorted(entries, key=lambda x: x.get('id', 0)):
            f.write(json.dumps(e, ensure_ascii=False) + '\n')
    os.replace(tmp, BUG_REPORTS_PATH)


@app.route('/api/bug_reports', methods=['POST'])
def bug_reports_create():
    """Submit a new bug report. Body:
        {
          "title":         "short summary",
          "description":   "detailed explanation",
          "page_url":      "/review",          # optional, where user was
          "reporter_email":"user@example.com", # optional but useful
          "store":         "dk" | "fr",        # optional
          "screenshot":    "data:image/png;base64,..."  # optional
        }
    """
    data  = request.json or {}
    title = (data.get('title') or '').strip()[:200]
    desc  = (data.get('description') or '').strip()[:5000]
    if not title:
        return jsonify({'error': 'title is required'}), 400

    bug_id = _next_bug_id()

    # Persist screenshot if attached (data URL → file on disk).
    screenshot_filename = None
    sshot = data.get('screenshot') or ''
    if sshot and sshot.startswith('data:image/') and ';base64,' in sshot:
        try:
            header, payload = sshot.split(';base64,', 1)
            ext = 'png'
            if 'jpeg' in header or 'jpg' in header:
                ext = 'jpg'
            elif 'webp' in header:
                ext = 'webp'
            decoded = _b64.b64decode(payload)
            if len(decoded) > 5_000_000:  # 5MB
                print(f"[bugs] dropping oversized screenshot ({len(decoded)} bytes)")
            else:
                fname = f'bug_{bug_id}.{ext}'
                with open(os.path.join(BUG_SCREENSHOTS_DIR, fname), 'wb') as f:
                    f.write(decoded)
                screenshot_filename = fname
        except Exception as ex:
            print(f"[bugs] screenshot save failed: {ex}")

    entry = {
        'id':             bug_id,
        'created_at':     datetime.datetime.utcnow().isoformat() + 'Z',
        'reporter_email': (data.get('reporter_email') or '').strip()[:120] or None,
        'store':          (data.get('store') or '').strip()[:8] or None,
        'page_url':       (data.get('page_url') or '').strip()[:500] or None,
        'title':          title,
        'description':    desc,
        'screenshot_filename': screenshot_filename,
        'status':         'open',
        'resolved_at':    None,
    }
    try:
        with open(BUG_REPORTS_PATH, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
    except Exception as ex:
        return jsonify({'error': f'Could not save bug report: {ex}'}), 500

    print(f"[bugs] #{bug_id} reported by {entry['reporter_email']}: {title!r}")
    # Best-effort Slack ping so the CEO knows a bug came in.
    try:
        _post_bug_to_slack(entry)
    except Exception as ex:
        print(f"[bugs] slack notify failed: {ex}")
    return jsonify({'success': True, 'id': bug_id})


def _post_bug_to_slack(entry):
    """Post a new bug report to Slack via the configured incoming webhook.
    No-op when no webhook is configured. Never raises to the caller path."""
    url = _slack_webhook_url()
    if not url:
        return
    bug_id = entry.get('id', '?')
    shop_base = os.getenv('PUBLIC_BASE_URL', 'https://188-166-11-177.nip.io').rstrip('/')
    sshot = f"{shop_base}/api/bug_reports/{bug_id}/screenshot" if entry.get('screenshot_filename') else None
    fields = [
        {'type': 'mrkdwn', 'text': f"*Reporter:*\n{entry.get('reporter_email') or 'unknown'}"},
        {'type': 'mrkdwn', 'text': f"*Store:*\n{(entry.get('store') or '—').upper()}"},
        {'type': 'mrkdwn', 'text': f"*Page:*\n{entry.get('page_url') or '—'}"},
        {'type': 'mrkdwn', 'text': f"*ID:*\n#{bug_id}"},
    ]
    blocks = [
        {'type': 'header', 'text': {'type': 'plain_text', 'text': f'🐛 New bug #{bug_id}', 'emoji': True}},
        {'type': 'section', 'text': {'type': 'mrkdwn', 'text': f"*{entry.get('title','(no title)')}*"}},
        {'type': 'section', 'fields': fields},
    ]
    desc = (entry.get('description') or '').strip()
    if desc:
        snip = desc[:600].replace('\n', '\n>')
        blocks.append({'type': 'section', 'text': {'type': 'mrkdwn', 'text': f">{snip}"}})
    if sshot:
        blocks.append({'type': 'section',
                       'text': {'type': 'mrkdwn', 'text': f"<{sshot}|📎 View screenshot>"},
                       'accessory': {'type': 'image', 'image_url': sshot, 'alt_text': 'screenshot'}})
    blocks.append({'type': 'context', 'elements': [
        {'type': 'mrkdwn', 'text': "Open Claude Code and say *“work the bug queue”* to fix."}]})
    req.post(url, json={'text': f"🐛 New bug #{bug_id}: {entry.get('title','')}", 'blocks': blocks}, timeout=10)


@app.route('/api/config/slack_webhook', methods=['POST'])
def config_slack_webhook():
    """Store the Slack incoming-webhook URL for bug pings (gitignored file).

    Write-once: refuses to overwrite an existing config (so a drive-by caller
    can't redirect bug notifications after setup). To replace it, delete
    slack_config.json on the server first. Validates the URL is a Slack
    incoming webhook."""
    data = request.json or {}
    url = (data.get('url') or '').strip()
    if not url.startswith('https://hooks.slack.com/services/'):
        return jsonify({'error': 'Provide a valid Slack incoming-webhook URL (https://hooks.slack.com/services/...).'}), 400
    if os.path.exists(SLACK_CONFIG_PATH) and not data.get('force'):
        return jsonify({'error': 'Already configured (write-once). Pass force=true only if you intend to replace it.'}), 409
    try:
        tmp = SLACK_CONFIG_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump({'bug_webhook': url}, f)
        os.replace(tmp, SLACK_CONFIG_PATH)
    except Exception as ex:
        return jsonify({'error': f'Could not save: {ex}'}), 500
    return jsonify({'success': True, 'configured': True})


@app.route('/api/bug_reports', methods=['GET'])
def bug_reports_list():
    """List bug reports. Default: open only. Pass ?status=all to see resolved too."""
    status = request.args.get('status', 'open')
    entries = _load_bug_reports(status_filter=None if status == 'all' else 'open')
    # Hide screenshot path from list-level response — the GET-by-ID returns it
    return jsonify({
        'open_count':  sum(1 for e in entries if e.get('status') == 'open'),
        'total_count': len(entries),
        'entries':     entries,
    })


@app.route('/api/bug_reports/<int:bug_id>/resolve', methods=['POST'])
def bug_reports_resolve(bug_id):
    """Mark a single bug as resolved."""
    entries = _load_bug_reports()
    found = False
    for e in entries:
        if e.get('id') == bug_id:
            e['status'] = 'resolved'
            e['resolved_at'] = datetime.datetime.utcnow().isoformat() + 'Z'
            found = True
            break
    if not found:
        return jsonify({'error': f'bug #{bug_id} not found'}), 404
    try:
        _rewrite_bug_reports(entries)
    except Exception as ex:
        return jsonify({'error': f'Could not update: {ex}'}), 500
    return jsonify({'success': True, 'id': bug_id})


@app.route('/api/bug_reports/<int:bug_id>/screenshot', methods=['GET'])
def bug_reports_screenshot(bug_id):
    """Serve a bug's screenshot image, if any was attached."""
    entries = _load_bug_reports()
    entry = next((e for e in entries if e.get('id') == bug_id), None)
    if not entry or not entry.get('screenshot_filename'):
        return jsonify({'error': 'no screenshot'}), 404
    fname = entry['screenshot_filename']
    # Sanity check the filename matches our pattern
    if not re.match(r'^bug_\d+\.(png|jpg|webp)$', fname):
        return jsonify({'error': 'invalid screenshot reference'}), 400
    return send_from_directory(BUG_SCREENSHOTS_DIR, fname)


# --- Recent product descriptions (used as tone references in Settings) ---

@app.route('/api/recent_descriptions', methods=['GET'])
def recent_descriptions():
    """Return the most recent ACTIVE products' body_html for a store, stripped of
    HTML tags so the dashboard can show them as plain-text tone examples.

    Query params:
      - store=dk|fr (required)
      - limit=N    (default 5, max 15)
    """
    store = (request.args.get('store') or '').strip().lower()
    if store not in tokens:
        return jsonify({'error': f'Not authenticated for {store}'}), 401
    try:
        limit = min(15, int(request.args.get('limit', 5) or 5))
    except Exception:
        limit = 5

    hdrs = shopify_headers(store)
    # GraphQL is way faster than REST here (one round trip, body_html in result).
    # Pull both ACTIVE and DRAFT products — the user wants their style anchor
    # to include the most recent work even if not yet published live (and some
    # stores like Vionna FR have all-draft recent imports).
    query = (
        '{ products(first: %d, sortKey: CREATED_AT, reverse: true, query: "status:active OR status:draft") '
        '{ edges { node { title handle descriptionHtml createdAt status } } } }'
    ) % limit
    try:
        r = req.post(shopify_url(store, 'graphql.json'),
                     headers=hdrs, json={'query': query}, timeout=20)
        edges = (r.json().get('data') or {}).get('products', {}).get('edges', [])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    def html_to_text(html):
        if not html:
            return ''
        # Convert paragraphs / list items to newlines, then strip remaining tags
        text = re.sub(r'</p\s*>', '\n\n', html, flags=re.I)
        text = re.sub(r'<li[^>]*>', '• ', text, flags=re.I)
        text = re.sub(r'</li\s*>', '\n', text, flags=re.I)
        text = re.sub(r'<br\s*/?\s*>', '\n', text, flags=re.I)
        text = re.sub(r'<[^>]+>', '', text)
        # Decode common entities
        text = (text.replace('&nbsp;', ' ')
                    .replace('&amp;', '&')
                    .replace('&lt;', '<')
                    .replace('&gt;', '>')
                    .replace('&quot;', '"')
                    .replace('&#39;', "'"))
        # Collapse 3+ newlines and trim
        text = re.sub(r'\n{3,}', '\n\n', text).strip()
        return text

    items = []
    for e in edges:
        n = e.get('node', {})
        body = html_to_text(n.get('descriptionHtml', ''))
        if not body:
            continue
        items.append({
            'title':       n.get('title'),
            'handle':      n.get('handle'),
            'created_at':  n.get('createdAt'),
            'description': body,
        })
    return jsonify({'store': store, 'items': items})


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
    # When set, regenerate ONLY this single field — one of:
    #   'description' / 'meta_description' / 'm_title_specs'
    # The frontend uses this for per-field "↻" buttons in the Review screen.
    only_field    = (data.get('only_field') or '').strip()
    # Optional existing values, included in the prompt so partial regenerations
    # stay consistent with the other fields the user is keeping.
    current_description       = data.get('current_description', '')
    current_meta_description  = data.get('current_meta_description', '')
    current_m_title_specs     = data.get('current_m_title_specs', '')
    # Optional list of full product descriptions from the user's own catalogue.
    # When non-empty, we use the FIRST entry as the style anchor (replacing the
    # hard-coded Liviah example) — keeps the dashboard-generated content sounding
    # consistent with their existing voice. Other entries are listed as additional
    # references the model can lean on.
    tone_references = data.get('tone_references') or []
    if not isinstance(tone_references, list):
        tone_references = []
    tone_references = [s for s in tone_references if isinstance(s, str) and s.strip()]
    language      = STORE_LANGUAGE.get(store, 'Frans')

    # Style anchor: user-supplied tone reference if provided, otherwise the
    # hard-coded Liviah default. The first user example replaces the example;
    # additional examples are appended as a separate "more references" block.
    extra_refs_block = ""
    if tone_references:
        example = tone_references[0]
        if len(tone_references) > 1:
            joined = "\n\n---\n\n".join(tone_references[1:])
            extra_refs_block = f"\n\nMeer voorbeelden ter referentie:\n---\n{joined}\n---"
    else:
        example = """Komfortabel og nem at bære

Liviah er en bluse med krave og V-udskæring med knapper foran. De korte ærmer giver et afslappet udtryk og gør blusen behagelig til daglig brug. Det ensfarvede design giver et roligt look og er nemt at kombinere med forskellige bukser.

• Bomuldsblanding: behageligt materiale til daglig brug
• Krave med V-udskæring: enkel og pæn detalje
• Korte ærmer: dejlige til varmere vejr
• Knapdetalje foran: subtilt accent
• Normal pasform: sidder komfortabelt og giver god bevægelighed

Liviah er en bluse, som er nem at tage på, og som føles behagelig hele dagen."""
    # Inject "more references" right after the primary example block in both
    # the single-field and full prompts below — done by string-concatenation
    # at the @Schrijf exact in de stijl van@ anchor.

    # ── Single-field regeneration (per-field ↻ buttons) ──
    if only_field in ('description', 'meta_description', 'm_title_specs'):
        client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)

        context_block = f"""Producttitel competitor: {product_title}
Keywords (verwerk de relevantste): {', '.join(keywords[:12])}
Productnaam: {product_name}
Taal: {language}"""

        if only_field == 'description':
            sub_prompt = f"""{context_block}

Schrijf ALLEEN de productbeschrijving (description) opnieuw, in exact deze stijl:
---
{example}
---

Regels:
- Gebruik productnaam ({product_name}) in eerste én laatste zin
- Eerste regel: korte pakkende zin over comfort/draagbaarheid (geen uitroepteken)
- Dan alinea met productnaam + kernkenmerken
- Dan 5 bulletpoints: **eigenschap**: korte uitleg
- Slotszin over hoe het voelt om te dragen
- Rustige toon, geen hype, geen superlatieven

Bestaande meta description (handhaaf consistentie): {current_meta_description!r}

Antwoord ALLEEN als geldig JSON:
{{"description": "..."}}"""
            max_tokens = 1000

        elif only_field == 'meta_description':
            sub_prompt = f"""{context_block}

Schrijf ALLEEN een nieuwe meta_description (max 155 tekens, SEO-geoptimaliseerd voor {language}).

Bestaande description (gebruik dezelfde toon + key benefits):
---
{current_description}
---

Antwoord ALLEEN als geldig JSON:
{{"meta_description": "..."}}"""
            max_tokens = 200

        else:  # m_title_specs
            sub_prompt = f"""{context_block}

Schrijf ALLEEN een nieuwe m_title_specs: één beschrijvende zin voor Google Shopping. Wordt gebruikt als: {product_name} | m_title_specs

Bestaande description (haal de hoofdkenmerken hieruit):
---
{current_description}
---

Antwoord ALLEEN als geldig JSON:
{{"m_title_specs": "..."}}"""
            max_tokens = 200

        msg = client.messages.create(
            model='claude-sonnet-4-5',
            max_tokens=max_tokens,
            messages=[{'role': 'user', 'content': sub_prompt}]
        )
        text = msg.content[0].text.strip()
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            return jsonify(json.loads(match.group()))
        return jsonify({'error': 'Kon respons niet parsen', 'raw': text}), 500

    # ── Full generation (default — all three fields at once) ──
    prompt = f"""Je bent een productschrijver voor een vrouwenmodezaak. Schrijf productcontent in het {language} voor een product genaamd "{product_name}".

Competitor producttitel: {product_title}
Keywords (verwerk de relevantste): {', '.join(keywords[:12])}

Schrijf exact in de stijl van dit voorbeeld:
---
{example}
---{extra_refs_block}

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


# --- Publish history (append-only JSONL log of every variant created) ---

def _append_history(entry):
    """Best-effort write to publish_history.jsonl. Never raise — history is observability."""
    try:
        entry = {**entry, 'timestamp': datetime.datetime.utcnow().isoformat() + 'Z'}
        with open(HISTORY_PATH, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
    except Exception as e:
        print(f"[history] append failed (ignored): {e}")


@app.route('/api/history')
def history():
    """Return the publish log as a list of entries, most recent first.

    Query params:
      - limit (default 200, max 500)
      - store (filter: dk | fr)
      - product (filter: case-insensitive substring of product name)
    """
    try:
        limit = min(500, int(request.args.get('limit', 200) or 200))
    except Exception:
        limit = 200
    filter_store = (request.args.get('store') or '').strip().lower()
    filter_product = (request.args.get('product') or '').strip().lower()

    if not os.path.exists(HISTORY_PATH):
        return jsonify({'entries': [], 'total': 0})

    entries = []
    try:
        with open(HISTORY_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except Exception:
                    continue
                if filter_store and e.get('store') != filter_store:
                    continue
                if filter_product and filter_product not in (e.get('product_name') or '').lower():
                    continue
                entries.append(e)
    except Exception as e:
        return jsonify({'error': f'Could not read history: {e}'}), 500

    entries.reverse()  # most recent first
    total = len(entries)
    return jsonify({'entries': entries[:limit], 'total': total})


# --- Publish helpers (shared by /api/publish and the granular per-variant endpoints) ---

def _publish_to_html(text):
    """Convert plain-text description to body_html (lists when '•' or '-').
    Truncates the output if it would exceed Shopify's 65535-char body_html
    cap so the publish call doesn't get rejected with a cryptic 422."""
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
    body = '\n'.join(html)
    # Shopify hard-caps body_html at 65535 chars; truncate at 60_000 to give
    # ourselves headroom for theme-wrapper tags and keep the closing </p>.
    if len(body) > 60_000:
        print(f"[publish] body_html too long ({len(body)} chars), truncating")
        body = body[:60_000].rsplit('</p>', 1)[0] + '</p><p><em>(truncated)</em></p>'
    return body


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


def _find_product_by_handle(store, handle, hdrs):
    """Return {'id': int} for an existing product at `handle`, else None.
    Used as an idempotency guard so re-running a publish (retry / double-click)
    doesn't create Shopify-suffixed duplicate products. Uses the REST handle
    filter which returns an exact (not prefix) match."""
    if not handle:
        return None
    try:
        r = req.get(
            shopify_url(store, f'products.json?handle={urllib.parse.quote(handle)}&fields=id,handle&status=any'),
            headers=hdrs, timeout=15,
        )
        if r.status_code == 200:
            for p in (r.json().get('products') or []):
                if (p.get('handle') or '') == handle:
                    return {'id': p.get('id')}
    except Exception as e:
        print(f"[publish] handle-existence check failed for {handle}: {e}")
    return None


def _publish_normalize_price(store, price_raw):
    """Strip currency suffix + apply per-store psychological suffix (.95 DK / .99 FR + FI)."""
    raw = (price_raw or '0.00').replace(',', '.').replace(' DKK', '').replace(' EUR', '').strip()
    try:
        price_int = int(float(raw))
        suffix = STORE_PRICE_SUFFIX.get(store, '.99')
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


# ── Sales-channel publishing ──────────────────────────────────────────
#
# Every product we create needs to live on Online Store + Facebook + Google
# regardless of its active/draft status. Shopify models this as a per-channel
# "publication" linked to the product. Listing publications is REST, but the
# actual link goes through GraphQL `publishablePublish` (the REST product
# publications resource is partially deprecated and doesn't cover all channels).
#
# Publications rarely change, so we cache the lookup per process — first
# product publish does the fetch, subsequent ones reuse it. Restart the
# backend if a sales channel gets added/renamed.
_PUBLICATION_CACHE: dict = {}  # store_key -> list of {id, name}

# Match shop-configured publication names case-insensitively. Shopify renames
# these every couple of years (Facebook → Facebook & Instagram, Google →
# Google & YouTube, etc.) so we use substring matches.
_DEFAULT_PUBLICATION_MATCHERS = ('online store', 'facebook', 'google')


def _list_publications(store, hdrs):
    if store in _PUBLICATION_CACHE:
        return _PUBLICATION_CACHE[store]
    try:
        r = req.get(shopify_url(store, 'publications.json'), headers=hdrs, timeout=15)
        if r.status_code == 200:
            pubs = r.json().get('publications', [])
            _PUBLICATION_CACHE[store] = pubs
            return pubs
        print(f"[publications] list failed ({store}): {r.status_code} — {r.text[:200]}")
    except Exception as e:
        print(f"[publications] list error ({store}): {e}")
    _PUBLICATION_CACHE[store] = []
    return []


def _default_publication_targets(pubs):
    """Filter to the three sales channels we always want products on. Picks at
    most ONE publication per category (online-store / facebook / google) — some
    shops have multiple Facebook channels (Shop, Marketplace, Instagram) which
    would otherwise inflate the list and waste mutations on near-duplicates."""
    chosen_by_category: dict = {}
    for p in pubs:
        name = (p.get('name') or '').lower()
        for needle in _DEFAULT_PUBLICATION_MATCHERS:
            if needle in name and needle not in chosen_by_category:
                chosen_by_category[needle] = p
                break
    return list(chosen_by_category.values())


def _publish_to_default_channels(store, product_id, hdrs):
    """Run the publishablePublish GraphQL mutation against the standard channels.
    Returns a list of error strings (empty = full success)."""
    pubs = _list_publications(store, hdrs)
    targets = _default_publication_targets(pubs)
    if not targets:
        return ['no matching publications (Online Store / Facebook / Google) found in shop']

    product_gid = f'gid://shopify/Product/{product_id}'
    publication_inputs = [
        {'publicationId': f'gid://shopify/Publication/{p["id"]}'} for p in targets
    ]
    mutation = (
        'mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {'
        ' publishablePublish(id: $id, input: $input) {'
        '   publishable { ... on Product { id } }'
        '   userErrors { field message }'
        ' }'
        '}'
    )
    body = {
        'query': mutation,
        'variables': {'id': product_gid, 'input': publication_inputs},
    }
    try:
        r = req.post(shopify_url(store, 'graphql.json'), headers=hdrs, json=body, timeout=15)
    except Exception as e:
        return [f'graphql request failed: {e}']
    if r.status_code != 200:
        return [f'graphql HTTP {r.status_code}: {r.text[:200]}']

    payload = r.json() or {}
    if payload.get('errors'):
        return [str(e.get('message') or e) for e in payload['errors']]
    pub_payload = (payload.get('data') or {}).get('publishablePublish') or {}
    user_errors = pub_payload.get('userErrors') or []
    return [f"{(ue.get('field') or [''])[0]}: {ue.get('message')}" for ue in user_errors]


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


def _build_image_payload(urls, max_images=10):
    """Build Shopify product-image dicts from a list of URLs.

    CRITICAL RELIABILITY FIX: instead of passing {'src': url} and trusting
    Shopify to asynchronously fetch it later, we download the bytes HERE
    (while the source URL is definitely alive — Higgsfield output URLs can
    expire or rate-limit Shopify's fetcher) and send them as a base64
    {'attachment': ...}. Shopify then stores the bytes synchronously, so an
    image can never silently fail to attach the way {'src': ...} does.

    Falls back to {'src': url} for any image we couldn't download, so a
    transient download error still has a chance via Shopify's own fetch.
    """
    seen = set()
    out = []
    for url in urls:
        if not isinstance(url, str) or not url.startswith('http'):
            continue
        if url in seen:
            continue
        seen.add(url)
        if len(out) >= max_images:
            break
        try:
            r = _scrape_get(url, timeout=20)
            r.raise_for_status()
            content = r.content
            if not content or len(content) > 20_000_000:   # 20MB sanity cap
                raise ValueError(f'empty or oversized image ({len(content) if content else 0} bytes)')
            b64 = _b64.b64encode(content).decode('ascii')
            # Derive a filename so Shopify keeps a sensible extension
            path = urllib.parse.urlparse(url).path
            fname = os.path.basename(path) or 'image.jpg'
            if '.' not in fname:
                fname += '.jpg'
            out.append({'attachment': b64, 'filename': fname})
        except Exception as e:
            print(f"[publish] image download failed ({url[:80]}): {e} — falling back to src")
            out.append({'src': url})
    return out


def _attach_images_one_by_one(store, prod_id, img_payload, hdrs):
    """Upload product images ONE PER REQUEST.

    Bundling many base64-encoded images into the single product-create POST
    blows past Shopify's request-size limit (413 Payload Too Large — 4 photos
    × a few MB each × 33% base64 overhead). So we create the product imageless
    and add each image via its own POST /products/{id}/images.json, which keeps
    every request small. Returns the list of created Shopify image objects (in
    upload order) so the caller can assign the first one to the variants.
    """
    created = []
    for i, img in enumerate(img_payload):
        try:
            r = req.post(
                shopify_url(store, f'products/{prod_id}/images.json'),
                headers=hdrs, json={'image': img}, timeout=60,
            )
            if r.status_code in (200, 201):
                created.append(r.json().get('image'))
            else:
                # If a base64 attachment was rejected, try Shopify's own fetch
                # via src as a last resort (we don't have the src here unless it
                # was the fallback shape, so just log).
                print(f"[publish] image {i+1} upload failed {r.status_code}: {r.text[:160]}")
        except Exception as e:
            print(f"[publish] image {i+1} upload error: {e}")
    return created


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
    size_option_name = STORE_SIZE_OPTION.get(store, 'Taille')

    # GUARD: an empty colour is the root of the duplicate + empty-cutline mess.
    # _publish_make_handle(name, "") collapses to a name-only handle, so EVERY
    # colourless variant of a product collides on the same handle — Shopify then
    # either auto-suffixes (-1/-2, the fake "duplicates") or the idempotency
    # guard reuses the first one and silently drops the rest. It also leaves an
    # empty theme.cutline (no colour swatch). Refuse instead of creating junk.
    color = (color or '').strip()
    if not color:
        return {
            'error': ('No colour set for this variant. Publishing it would create '
                      'an empty cutline and a name-only handle that collides with '
                      'the product\'s other colours (the cause of the duplicate '
                      'listings). Set a colour for this variant and retry.'),
            'metafield_errors': [],
        }

    product_handle = _publish_make_handle(product_name, color)

    # IDEMPOTENCY GUARD: if a product already exists at this exact handle, the
    # publish has already created this colour (e.g. the user hit "Retry
    # publish" after a partial failure, double-clicked, or two tabs raced).
    # Re-creating would make Shopify auto-suffix the handle (jasmine-X-1) and
    # leave duplicate products — exactly the Jasmine mess we just cleaned up.
    # Reuse the existing product instead of creating a duplicate.
    existing = _find_product_by_handle(store, product_handle, hdrs)
    if existing:
        eid = existing.get('id')
        shop_domain = tokens.get(store, {}).get('shop', '')
        print(f"[publish] Color '{color}' handle='{product_handle}' already exists (id={eid}) — reusing, skipping create")
        return {
            'product_id':      eid,
            'product_url':     f'https://{shop_domain}/admin/products/{eid}' if shop_domain else '',
            'metafield_errors': [],
            'reused':          True,
        }

    # Download + base64-encode images (reliable — no dependency on Shopify
    # async-fetching the Higgsfield URL later). Uploaded SEPARATELY below to
    # avoid 413 Payload Too Large from bundling them into the create request.
    img_payload = _build_image_payload(images, max_images=10)

    # Create the product WITHOUT images first.
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
        }
    }
    print(f"[publish] Color '{color}' handle='{product_handle}' images={len(img_payload)} (uploaded separately)")

    prod_res = req.post(f"{base}products.json", headers=hdrs, json=product_payload)
    if prod_res.status_code not in (200, 201):
        return {'error': f'Product create failed ({prod_res.status_code}): {prod_res.text[:200]}',
                'metafield_errors': []}

    prod_data = prod_res.json()['product']
    prod_id   = prod_data['id']

    # Upload images one at a time (avoids the 413 from bundling base64 bytes).
    uploaded_images = _attach_images_one_by_one(store, prod_id, img_payload, hdrs)

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
    prod_variants = prod_data.get('variants', [])
    if uploaded_images and prod_variants:
        first_image_id = (uploaded_images[0] or {}).get('id')
        if first_image_id:
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

    # --- Publish to default sales channels (Online Store, Facebook, Google) ---
    # Done unconditionally regardless of product status (draft or active) — the
    # user wants every duplicate listed on every channel from day one.
    try:
        channel_errors = _publish_to_default_channels(store, prod_id, hdrs)
        if channel_errors:
            for err in channel_errors:
                mf_errors.append(f'sales channels: {err}')
    except Exception as e:
        mf_errors.append(f'sales channels: {e}')

    shop_domain = tokens.get(store, {}).get('shop', '')
    product_url = f'https://{shop_domain}/admin/products/{prod_id}' if shop_domain else ''
    return {'product_id': prod_id, 'product_url': product_url, 'metafield_errors': mf_errors}


# --- Granular publish endpoints (for live per-variant progress in the dashboard) ---

@app.route('/api/publish/start_store', methods=['POST'])
@require_droplet_token
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
@require_droplet_token
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

    # Log to publish history (best-effort, ignored on failure)
    _append_history({
        'store':         store,
        'product_name':  product_name,
        'color':         color,
        'product_id':    result.get('product_id'),
        'product_url':   result.get('product_url'),
        'collection_handle': actual_handle,
        'image_count':   len(images),
        'metafield_errors': result.get('metafield_errors') or [],
    })
    return jsonify({'success': True, **result})


# --- Publish to Shopify ---
@app.route('/api/publish', methods=['POST'])
@require_droplet_token
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
    # Adjust selling price suffix: .95 for DK, .99 for FR + FI (via STORE_PRICE_SUFFIX)
    try:
        price_int   = int(float(price_raw))
        suffix      = STORE_PRICE_SUFFIX.get(store, '.99')
        price       = f'{price_int}{suffix}'
    except Exception:
        price       = price_raw
    print(f"[publish] Price '{price_raw}' -> '{price}' (store: {store})")
    compare_at_price = data.get('compare_at_price')   # optional, None = no compare price
    size_option_name = STORE_SIZE_OPTION.get(store, 'Taille')
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
        # Download + base64-attach (reliable) instead of {'src': url} async fetch
        img_payload = _build_image_payload(all_imgs, max_images=10)
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
                # Images uploaded separately below to avoid 413 Payload Too Large.
            }
        }
        print(f"[publish] Product handle: '{product_handle}' | Sample SKU: '{make_sku(product_name, color, sizes[0] if sizes else 'M')}'")

        prod_res = req.post(f"{base}products.json", headers=hdrs, json=product_payload)
        if prod_res.status_code in [200, 201]:
            prod_data  = prod_res.json()['product']
            prod_id    = prod_data['id']
            created.append(prod_id)
            # Upload images one at a time (avoids the 413 from bundling base64)
            uploaded_images = _attach_images_one_by_one(store, prod_id, img_payload, hdrs)
            prod_data['images'] = uploaded_images or prod_data.get('images', [])

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
            prod_images  = [im for im in (prod_data.get('images') or []) if im and im.get('id')]
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
    2: ("I've uploaded a photo of OUR model wearing a {product_type}. Keep the SAME model — same "
        "face, hair, skin tone and body — and the SAME background, lighting and styling. Keep every "
        "detail of the {product_type} (cut, colour, fabric, design elements) identical to the "
        "reference. Generate a new detailed shot where her ENTIRE FACE is clearly visible and the "
        "product's design details are prominent. CRITICAL: the model must be in a clearly DIFFERENT "
        "POSE than in the reference image — change her stance, arm position, body angle and head "
        "orientation so the result is visibly a different photo, NOT a copy of the reference. Same "
        "model, same outfit, same setting — new pose."),
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
         "background and styling identical to IMAGE 1, but make sure the model has a different pose "
         "than in IMAGE 1."),
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
                r = _scrape_get(url, timeout=15)
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
            raw_err = '; '.join(errors[:2]) or 'No images received from Higgsfield'
            return jsonify({'error': _map_higgsfield_error(raw_err),
                            'raw_error': raw_err,
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
        return jsonify({'error': _map_higgsfield_error('timeout')}), 504
    except Exception as e:
        return jsonify({'error': _map_higgsfield_error(str(e)), 'raw_error': str(e)}), 500
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
