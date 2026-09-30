# Vionna Dashboard — working notes for Claude

Product-import tool for the Vionna Shopify stores (Denmark + France). Scrapes a
competitor product, generates per-store content via Claude, makes model photos
via Higgsfield (Nano Banana), and publishes to Shopify with variants, metafields
and sales channels.

- Frontend: Next.js on Netlify — `frontend/` (auto-deploys on push to `main`)
- Backend: Python Flask on a DigitalOcean droplet — `backend/server.py`
  - Public base URL: `https://188-166-11-177.nip.io`
  - Self-updates from `main` automatically (see "Deploy & self-update" below);
    bump `backend/version.txt` for any backend change so the droplet picks it up.
- Repo is PUBLIC — never commit secrets. `.env`, `tokens.json`, `slack_config.json`
  are gitignored and live only on the droplet — as does `spy_shield.jsonl` (visitor
  records of the Spy Shield beacon, see below).

---

## 🔄 Deploy & self-update (backend, since v1.249.0)

Deploying the backend = push to `main` with a higher `backend/version.txt`.
Nothing else. The droplet installs it itself within ~10 minutes:

- `_self_update_loop` in `backend/server.py` (daemon thread, right after the
  backup loop) checks the local `/api/version` every 10 min and, when
  `update_available`, POSTs `http://127.0.0.1:$PORT/api/update` (PORT default
  5000). That call is genuinely local (no `X-Forwarded-*` headers), so the
  security gate on `/api/update` lets it through tokenless. After the pull the
  process restarts itself.
- There is deliberately **no systemd unit / cron** for updates: the updater
  lives inside `server.py` so it deploys with every update and can never be
  missing from the box. (History: the old `api_update` comment referred to a
  systemd self-updater that was never actually created; when the security
  harding gated `/api/update`, the employee-facing "Install update" banner
  button broke too and the droplet silently sat on v1.244 while `main` was at
  v1.247 — security fixes included. The banner in the legacy `index.html` is
  now informational only.)
- Verify from anywhere: `curl https://188-166-11-177.nip.io/api/version` →
  `"self_update":"active"` means the updater thread is running; after a push,
  `local` should equal `remote` within ~10 min.
- Kill switch: set `SELF_UPDATE=0` in the droplet's `.env` (or environment).
  Local dev (`start.bat`) and pytest skip the updater automatically
  (`DEV_LOCAL=1` / pytest import guard) — otherwise it would overwrite your
  working tree with the GitHub versions.
- If the droplet ever runs a version older than v1.249.0 (pre-updater), one
  manual kick in the DigitalOcean console is needed:
  `curl -X POST http://127.0.0.1:5000/api/update`
- Known limit (pre-existing): the updater runs inside the Flask process, so if
  the process is down or a bad release crashes on boot, nothing can self-heal —
  that needs the DO console.

---

## 🌐 Scraper egress proxy (since v1.257.0)

Competitor shops rate-limit the droplet's **datacentre IP**, not our code — the
recurring "the dashboard can't read the competitor" reports (#28, #32, #34) are
all this. Measured while #34 was open: murci.co.uk answered 429 to the droplet
and 200 to the same requests from another IP; identical bestseller scans took
123s on the droplet vs ~5s elsewhere.

`_scrape_get` therefore sends every competitor request through a proxy with
residential IPs when one is configured.

**Configure it in the dashboard** (since v1.259.0): Settings → *Scraper proxy —
competitor access*. Paste the provider's gateway URL, press **Save and test**.
The backend writes it to `.env`, applies it to the running process (no restart —
`_scraper_proxies` reads `os.getenv` per request) and then proves it works by
comparing our egress IP with and without the proxy. If the IP does *not* change
it says so: `_scrape_request` falls back to a direct connection on proxy
failure, so a wrong password otherwise looks exactly like success.

Behind the form, the same two `.env` keys as before (gitignored — the URL holds
credentials, never commit it). Editing them by hand still works:

```
SCRAPER_PROXY_URL=http://user:pass@gateway.provider.net:port
SCRAPER_PROXY=0        # kill switch — direct traffic again (restart to apply)
```

`POST /api/save_scraper_proxy` is token-gated and only ever writes those two
keys (`_ENV_ALLOWED_KEYS`); it rejects a URL containing whitespace, a malformed
port, or a non-http(s) scheme, and never logs or returns the value.
`GET /api/scraper_proxy_status` is the non-secret view — unlike `/api/health` it
tells "no URL set" apart from "kill switch on".

- Unset = direct traffic, exactly as before. The code ships inert until the key
  is set, so deploying it changes nothing on its own.
- Asset CDNs (`cdn.*`), localhost and **our own public host** always go direct:
  images are most of the bytes, aren't what gets rate-limited, and residential
  proxies bill per GB. (Our own host matters since v1.279.0 — publish downloads
  generated photos from `/api/hf_media`, see below.)
- A proxy that is down falls back to a direct request (logged) rather than
  taking the scraper with it.
- Verify from anywhere: `curl https://188-166-11-177.nip.io/api/health` →
  `"scraper_proxy":true`. Then
  `curl "https://188-166-11-177.nip.io/api/bestseller_scan?domain=murci.co.uk"`
  should return `ok:true` instead of the 429 "blocked" message.

---

## 🛡️ Spy Shield beacon (since v1.314.0, hardened in v1.315.0, derived default token in v1.316.0)

- **Derived default token (v1.316.0):** when `.env` has no `SPY_SHIELD_BEACON_TOKEN`,
  the droplet accepts `sha256('spy-shield-beacon:' + <DK admin token>)[:32]` (one-way,
  reveals nothing about the admin token). The owner computes the same URL on his
  laptop with `~/Documents/spy-shield/install.py --beacon-url` — no dashboard login
  needed to configure the six themes. Rotate in the tab pins an explicit token that
  wins over the derived one; rotating the DK admin token changes the derived URL
  (re-paste or Rotate). `SPY_SHIELD_BEACON_DERIVE=0` disables the derivation.

"Spy Shield" is a theme snippet (repo `vionna-store-themes`) that shows a fake
"502 Bad Gateway" to competitor-research traffic (PPSpy, Koala, WinningHunter,
…) on the six stores. Every decision it takes sends ONE small JSON record via
`navigator.sendBeacon` to a beacon URL set in the theme settings. The theme
**refuses Block mode while that URL field is empty** ("never block blind"), so
this backend is the prerequisite for ever switching a store to Block.

- **Route:** `POST /api/spy_shield/<token>` — **ungated by design** (storefront
  browsers post to it; there is no session). What keeps it safe instead:
  the path token is compared constant-time against `SPY_SHIELD_BEACON_TOKEN`
  (wrong or missing → still 204, counted as rejected: no oracle); body ≤ 2 KB;
  JSON object with `event:"spy_shield"` and `ss_action` ∈ allow/monitor/block;
  field whitelist (`_SS_FIELDS`) with per-field truncation, 0/1 coercion and a
  UTF-8 check (a lone-surrogate escape is rejected as `shape` before it costs
  budget); rate limit **30/min and 300/day per IP** and 20 000/day globally
  (silent drop — the per-IP daily cap is what stops one source from eating the
  whole day budget); **append-only** to `backend/spy_shield.jsonl` (ASCII-only
  lines) and **no other side effect** (no Slack, no PR, no shop call — "no
  auto-actions ever"). Every branch answers `204` with an empty body; the
  handler is wrapped so `handle_error` can never turn a crash into a JSON 500.
  Kill switch: `SPY_SHIELD_BEACON=0` in `.env`.
- **The token is public by design.** The theme prints the beacon URL in the
  source of every storefront page, so `SPY_SHIELD_BEACON_TOKEN` is spam-gating,
  not authentication: it only keeps random scanners out; the rate limits and
  the append-only/no-side-effect route are the actual protection. Never reuse
  it for anything else. Consequence: **anyone with the URL can forge a record**
  (a red "Buyers in flagged sessions" tile, an `ss_pt` alarm). The tab therefore
  shows how many browsers are behind a red tile and the checklist says: open
  the order / read the raw log before acting, never act on one red tile.
- **Client IP** = the LAST `X-Forwarded-For` hop (the one Caddy appended), and
  only when the request came in over loopback (= via Caddy); otherwise
  `remote_addr`. A first hop is poster-controlled and is ignored. To make
  "every request passes Caddy" true, **Flask binds to `127.0.0.1` since v1.315**
  (`BIND_HOST` in `.env` overrides; Caddy and the self-updater both talk to
  127.0.0.1 already). Werkzeug's access log skips `/api/spy_shield/` lines.
- **Privacy:** the raw IP and the user-agent are never stored. The record
  carries `browser_key = sha256(daily_salt + ip + ua[:120])`, `daily_salt =
  sha256(DROPLET_TOKEN_SECRET + YYYY-MM-DD)`. The salt must come from
  `DROPLET_TOKEN_SECRET` (always set on the droplet — the gates fail closed
  without it); on a box without it a random per-process salt is used, **never
  the beacon token** (that is public, so the key would be recomputable). The
  key rotates daily, so "unique browsers" are **browser-days**.
- **Token:** `SPY_SHIELD_BEACON_TOKEN` in the droplet's `.env`, minted from the
  dashboard: `POST /api/spy_shield/setup` (gated, body `{"rotate": bool}`) writes
  it through `_env_write` (it is on `_ENV_ALLOWED_KEYS`), applies it to
  `os.environ` live (no restart) and returns only `beacon_url`
  (`https://188-166-11-177.nip.io/api/spy_shield/<token>`). **Rotating does NOT
  downgrade the themes:** the theme only refuses Block when the URL field is
  empty, so a store left in Block with the old URL keeps serving 502s while
  every beacon is dropped as `token` — blocking blind. Set the stores to
  Monitor before rotating and re-paste right away; the tab shows a warning
  banner while `dropped.token` keeps rising.
- **Log:** `backend/spy_shield.jsonl` (gitignored, droplet-only, in the daily
  backup list of `_run_backup`). One line per record: `ts`, `day` (UTC),
  `store` (dk/fr/fi/nl/com/de/unknown from `shop.permanent_domain`),
  `browser_key` + the whitelisted `ss_*` fields. **Bounded:** `_ss_prune`
  rewrites it once a day (temp file + `os.replace` under `_SS_LOCK`) keeping 90
  days, and above 100 MB new records are dropped as `full`. The prune runs from
  the digest tick, never from the beacon route.
- **Reading it:** the Tools menu entry **"Spy Shield"** opens `/spy-shield`
  (full-screen page like Margin watch) which calls
  `GET /api/spy_shield/summary?days=7|14|30&store=all|dk|…` (gated: session
  token OR `X-Notify-Token` = `NOTIFY_SECRET`, so master-dashboard can pull the
  digest line server-to-server — that caller gets `beacon_url: null`, the
  write token is dashboard-session information). A period of N days = today +
  N-1 UTC days. Per store: hits × reason × action, `block_tier_hits` (the
  "Would-be blocks" tile: what WOULD get the 502 — in Monitor `by_action.block`
  stays 0), browser-days, `utm_hits`, `first_hit_at` + `active_days` (the
  14-clean-days rule per store), `pt_alarm` + `pt_alarm_active` (records from a
  preview theme count as an alarm only when > 5 % or > 10 AND newer than 2
  days — venek's own duplicate-theme tests must not paint the tab red for
  weeks), daily counts, last 20 hits (never `browser_key`), and
  **`buyers_flagged`**: Vionna orders (DK/FR/FI, via `tokens.json`) whose
  `landing_site` path matches a block-tier record of the same store within
  ±60 min — by page and time, not by cookie, so a coincidence is possible;
  `matched_browsers` says how many browsers are behind the matches. That
  counter must be 0 before a store goes to Block; `null` means orders could
  not be read (no token / no `read_orders`) — not proof of 0 (orange tile).
  Orders are cached per (store, window) for 30 min; a failed read only 60 s.
  Light Supplier is not wired up (their tokens are in `LIGHT_TOKENS` /
  `_shop_entry`, `read_orders` unverified) — the tab says so.
- **Daily Slack line (stopgap):** `_spy_shield_digest_tick` posts one line at
  ~09:05 **droplet-local time (UTC → 11:05 NL in summer)** via the bug-report
  webhook (`_slack_webhook_url`), only when there are records; the posted day
  is persisted in `backend/spy_shield_digest.json` so a self-update restart
  cannot post twice. Same vocabulary as the tiles (`N would-be blocks, N 502s
  getoond, N buyers in flagged sessions, N browser-dagen · DK n / FR n`), plus
  warnings for an active `ss_pt` alarm, dropped records and `token` drops.
  The real dagbericht is composed in master-dashboard; once it pulls the
  summary with `X-Notify-Token`, disable this loop with `SPY_SHIELD_DIGEST=0`.
  Guarded like the other loops (skipped under pytest / DEV_LOCAL).
- **Verify:** `curl -X POST -d '{}' https://188-166-11-177.nip.io/api/spy_shield/wrong`
  → `204` and nothing appended. Tests: `backend/tests/test_spy_shield.py` +
  `test_spy_shield_review.py` (the v1.314 review findings as regression tests).

---

## 🔎 Import type check (since v1.324.0)

Carina (30 Sep 2026): the competitor page's TITLE and description said
moccasins, but its own product_type ("Dress Pants Women"), tags, XS–XL sizes
and photos said trousers. The import took the title → 24 listings live as
shoes in three languages, and keywords, copy, SEO title, sub-tag and chart were
all written FROM that wrong type (so no later check on our own copy can see it).

The type is now decided ONCE at import (`POST /api/resolve_type`, gated;
`_resolve_type` in server.py, `lib/typeCheck.ts`, `GenerateStep.checkType`):
- `_garment_cat` = one lexicon (EN/FR/DK/FI/NL/DE) for titles, product types,
  tags and keywords. Order matters (dress/skirt/pants before shoes, shoes before
  knitwear/tops, accessories last via `_nb_category`); DK/FI compounds match
  word-final. Table test: `backend/tests/test_type_check.py`.
- Hard conflict = title vs the competitor's own product_type (tags only when
  one of those is silent), or "shoes" sold in XS–XL / a Pointure option on a
  garment. Overlaps (knit dress typed Knitwear, shorts typed Pants, shirt
  jacket) are soft (`_GT_SOFT_PAIRS`). The DESCRIPTION never decides alone
  (prose is noisy: "egenskaber", "garde-robe"): with no type in title / type /
  tags the photos decide and the description only backs them. Measured on
  9,406 competitor products: 0.56% hard conflicts + ~12% naming no type → a
  photo check on ~1 in 8 imports (3–5 s, ~1–2 ct). Even-only numeric sizes
  (36/38/40) count as clothing, like XS–XL. Photo URLs: public hosts only.
- On conflict ONE vision call (sonnet-4-6, 2–4 photos of different colours, NO
  competitor text: "the item that changes colour is the product"). The photos
  win only when a competitor field backs them; otherwise — or when the call
  fails (429/timeout = BLOCKED, never agreement) — the operator picks in
  `TypeChoiceModal` before anything is researched or written.
- Everything follows the settled type: keyword seeds (type rule) and
  `_fashion_type_conflict` drops other-family keywords; `/api/generate` gets a
  type line, never the misleading title/description (fabric/length guards stay
  on), and retries once when m_title_specs names another type (`type_mismatch`
  flag otherwise); sizes via `competitorSizes(nbCategory(productType))`;
  publish sends `category` (`_category_for_publish` honours it unless the
  operator re-typed product_type). Taxonomy memo keyed on (family, category).
- Verified live 30 Sep: Dejana → trousers, Tatjana (title boots) → jacket,
  meshki Maddi (typed Tops) → shoes; ~3–5 s per checked import.
- Plural-only garments get a grammar hint in the copy prompt
  (`_TYPE_GRAMMAR_HINT`: DK "et par bukser/sko", FI "housut/kengät") — the
  Carina repair first came back as "Carina er en bukser".
- The live repair of 30 Sep (Carina 24, Stella FI 7, Virginie 24 type/chart,
  Gaia DK 1) is backed up per product in `~/Documents/type-fix-2026-09-30/`.
- Also fixed here: the blog scheduler, the WTL traffic/classify loops and the
  deletion watchdog started on EVERY import of server.py (local scripts, tests)
  — now behind `_background_loops_allowed()` like the other write loops.

---

## 🧾 After Quotation (since v1.321.0)

Fashion listings are made BEFORE the supplier quote: placeholder XS–XL and the
competitor's chart (measured 29 Sep 2026: 49 DK shoe listings sold XS–XL
against an EU 35–42 chart). Tools menu → **"After quotation"** opens
`/after-quotation`: search a listing, upload/paste what the supplier sent (AI
pre-fills the form), check sizes / size chart / colours / photos / material
facts, preview per store, apply. Code: server.py section "AFTER QUOTATION"
(`_aq_*`, routes `/api/aq/*`, all gated), `components/after-quotation/`,
`lib/afterQuotation.ts`.

- **Model it relies on:** one product = one colour in one store; title = name
  (same in DK/FR/FI); size is the ONLY option; colour in `theme.cutline`, handle,
  SKU and `global.title_tag`. A family = `theme.siblings` (same handle in every
  store). Colours are lined up across stores by colour concept, then by creation
  order (`_aq_rows`, `match: colour|order` — the page marks order matches ≈).
- **Writes:** sizes = ONE product PUT with the full variant list — a size that
  stays keeps its variant id (orders + COGS matching stay attached), a new size
  copies price/compare-at/tax/inventory settings; verified by reading back.
  Rename = cutline + title_tag + SKUs, **never the handle** (ads/links keep
  working). Hide = status draft, never delete. New colour = `_publish_one_variant`
  with the family's own copy/tags/price/siblings collection + uploaded photos.
  Descriptions = model-edited HTML (`_aq_clean_html`), only when ticked.
- **Safety:** apply re-reads Shopify and refuses when the listing's signature
  (`_aq_state_sig`) moved since the preview; every touched product is written to
  `backend/aq_backups/<id>.json` BEFORE the first write, and the backup records
  per product WHAT the apply wrote (`writes`). `POST /api/aq/undo` restores only
  those fields and only where Shopify still holds what was written (a field
  changed since — by hand, a later apply, the chart self-heal, margin watch — is
  left alone and named in the log); changes are undone newest first. Recreated
  variants get new ids; new colours go to draft. Log: `backend/aq_history.jsonl`
  (an `apply` line right after the backup + `apply_done` at the end — no done
  line = `interrupted`, still undoable). Both gitignored, droplet-only, in
  `_run_backup`; the self-updater waits for a running apply before restarting.
  Jobs live in `_AQ_JOBS` with random ids behind the gated `/api/aq/job` — NOT
  in `_JOBS` (the catalogue-job status route is open).
- **Refuses (plan errors):** a colour group mixing products (`theme.siblings`
  shared by e.g. a blouse and a jacket — 13 of 860 groups on 29 Sep), products
  with ≠ 1 option, two variants with the same size, unsafe colour names.
- **Untrusted input:** supplier files and model output. Description HTML goes
  through `_aq_clean_html` (allow-list parser, no attributes except a safe
  `<a href>`); .xlsx via a streaming stdlib parser with caps; per-route body
  limits (`_AQ_BODY_LIMITS`, no-length bodies refused).
- **Index (v1.322):** `_aq_index` = all active+draft products per store (GraphQL,
  250 per page) + archived ones on the side (their orders count), served
  stale-while-revalidate (10 min), saved to `backend/aq_index_<store>.json`
  (gitignored) so a deploy restart serves the list in ~0.2 s instead of ~12 s;
  warmed 3 s after start. A write is patched in BY ID (`_aq_index_patch` —
  Shopify's product search lags writes) and replayed into builds for 180 s;
  a build that suddenly finds < half the products is refused (last good copy).
  Summaries are built once per data version (`_aq_summaries`); a search only
  filters (1–2 ms, was 2.3 s — `_color_concept` is memoised).
- **Page:** downloads the slim list once (`GET /api/aq/list`, gzipped) and
  filters in the browser while typing; links/ids/competitor URLs go to
  `/api/aq/search` (cancellable). Last list cached in localStorage for an
  instant open. Default view **Recommended** = colour groups whose first order
  just came in (newest first; "first order known" first), then the rest of
  Needs attention.
- **Orders:** `backend/aq_orders.json` (gitignored, in `_run_backup`) — per
  order: created, cancelled, test, product ids (currentQuantity > 0). No
  customer data. The app has `read_orders` but not `read_all_orders`, so
  Shopify shows 60 days: `tracking_since` = first sync − 59 d; a first order is
  only "known" when every colour (archived too) was created after that.
  Incremental sync every 10 min (updated_at cursor), full window daily; a
  failing store backs off and is reported, never shown as "no orders".
- **Shopify pacing (all callers):** `_shopify_call` paces per shop, GraphQL on
  its cost budget from `extensions.cost.throttleStatus` (it used to force a
  global 0.55 s gap after every GraphQL call). JSON under `/api/` is gzipped;
  CORS preflights cached 2 h.
- **Sizes from competitors (v1.323):** a new listing takes the competitor's
  sizes (`lib/competitorSizes.ts`, server twin `_competitor_sizes` — the SAME
  case table runs in `backend/tests/test_listing_sizes.py` and
  `frontend/tests/competitorSizes.test.ts`; 0 differences on 28,218 sample
  cases). Bare numbers are converted only when the shop is UK (.co.uk / "UK")
  or AU (.com.au / "AU"; AU shoes 5 = EU 36); otherwise XS–XL with a note —
  the same "8" is a UK S, a US M and an AU shoe 38. A letter carrying an EU
  number in a list of numbers keeps the NUMBER ("Lady S (46)" = 46). 1XL/0XL
  and 3XS are sizes of their own, never merged. Accessories = One Size, but the
  competitor's real sizes stay restorable ("↺ Competitor sizes" never restores
  a fallback). An explicitly empty size list is refused at publish.
  The **Sizes from competitors** tab backfills listings still on XS–XL: check
  (dry run) → tick → apply through the normal apply (backup + undo). A group is
  only proposed when EVERY colour and store is on XS–XL (else `mixed`);
  unreadable competitor sizes are `unreadable`, never "already right"; rows
  with sales, or sales we can't see (listed before `tracking_since`), start
  unticked. Apply skips a group when its quotation was applied since the check,
  any colour's sizes or the colour list changed (per-product `snapshot`), or a
  store can't be read — and schedules ONE index rebuild per store at the end.
- **Tests:** `backend/tests/test_after_quotation.py`, `test_listing_sizes.py`,
  `frontend/tests/afterQuotation.test.ts`, `competitorSizes.test.ts`.

---

## 🐛 Codeword: "bug"

When the user says **"bug"** (also accept "bugs", "/bug", "fix bugs", "work the
bug queue"), run this flow without asking for clarification first:

1. **Fetch the open queue:**
   ```bash
   curl -sS "https://188-166-11-177.nip.io/api/bug_reports?status=open"
   ```
2. **If reachable and `open_count > 0`:** summarise each open bug (id, title,
   reporter, store, page_url, and the screenshot link
   `https://188-166-11-177.nip.io/api/bug_reports/<id>/screenshot` if it has one),
   then start fixing them — lowest id first — unless the user named a specific one.
3. **If the queue API is NOT reachable** (cloud / mobile sessions have restricted
   network egress and often can't reach the droplet): say so in one line and ask
   the user to paste the bug text from the `#bugs-report` Slack message, then fix
   from that.
4. **After fixing each bug:**
   - **Local laptop session:** commit + push to `main` (Netlify + droplet auto-deploy;
     bump `backend/version.txt` if backend changed), then mark it resolved:
     ```bash
     curl -sS -X POST "https://188-166-11-177.nip.io/api/bug_reports/<id>/resolve"
     ```
   - **Cloud / web session:** open a PR (ready for review, **not** a draft — a
     draft cannot auto-merge), turn on **auto-merge (squash)**, and let CI be the
     gate. Read back whether auto-merge actually got enabled; if it didn't, wait
     for CI and merge yourself once green. Then mark the bug resolved if the
     droplet API is reachable.
5. **If GitHub Actions gives no verdict** (it stopped assigning runners entirely
   on 2026-08-06 — `runner_id: 0`, jobs cancelled after ~15 min queued), run
   `bash scripts/ci-local.sh`. It runs exactly what `ci.yml` runs and prints a
   pass/fail verdict. Say in the PR that the verdict is local, and why. Never
   present a local run as if CI had passed.
6. CI is the gate that makes this safe, not a human read-through: `.github/
   workflows/ci.yml` runs the backend tests + an import smoke test on the file the
   droplet executes, plus the same `next build` Netlify publishes. Never merge
   red, and never disable a check to get to green.
7. Still require a human for: anything that spends money, anything that writes to
   Shopify with live tokens, and any change whose *cause* lies outside the code
   (empty API balance, expired key, shop down) — those go through
   **Plans** (see below), not a PR.

Notes:
- The bug queue + Slack ping are handled entirely by the droplet; Claude does NOT
  need any Slack access — only the GitHub repo + (when reachable) the public API.
- Data-mutation tasks that need live Shopify tokens (`tokens.json`) only work from
  the laptop, not cloud sessions.

---

## 🖼️ Generated photos live on OUR disk (since v1.279.0)

`/api/higgsfield` no longer hands back a Higgsfield CDN URL. It downloads every
result while the generation is fresh, stores the bytes in `backend/hf_media/`
(gitignored) and returns `https://…/api/hf_media/hf_<sha1>.<ext>`.

Why: on 2026-08-26 every object Higgsfield produced answered **403 from the
first second** — older objects in the same bucket, same user prefix, still
answered 200, so nothing expired. The dashboard kept those URLs in the draft,
publish tried to download them hours later, failed, fell back to `{'src': url}`,
and Shopify accepted that with a 201 before failing the identical fetch itself.
Nine products created with zero photos and no error anywhere (bug #46; #43/#44/
#45 are the same import).

- A result that can't be downloaded is **dropped at generation**, never handed
  to the frontend as a selectable tile. All of them undownloadable ⇒ HTTP 502
  with a real message, not a green "4 images".
- Names are content-addressed (sha1 of the bytes), so a re-roll of an identical
  result costs no extra disk and the serve route can validate the name against
  one regex — nothing else on the droplet is reachable through it.
- The serve route is **ungated on purpose**: Shopify's own image fetcher and the
  Meta-ads job read these URLs and neither can carry a session token. They are
  model photos we generated ourselves; nothing there is secret.
- Fetched **direct**, never through the scraper proxy — that proxy is for
  competitor shops that rate-limit our datacentre IP and it bills per GB, and
  these files are 5-9 MB each.
- Retention: `HF_MEDIA_RETENTION_DAYS` (default 30), pruned on every generation.
  Deliberately **not** in `_run_backup`'s file list — 14 day-folders of photos
  would fill the droplet. A draft published within the window keeps working; an
  abandoned one loses its photos, later and on purpose.
- Verify from anywhere: `curl https://188-166-11-177.nip.io/api/health` →
  `"hf_media":{"files":N,"mb":X,"retention_days":30}`.

Two things nearby changed with it:
- `/api/selftest?what=higgsfield` now **downloads** the image it generated. It
  used to check only that a URL came back, so it reported `ok:true` straight
  through this outage. New failure reason: `unreachable_output`.
- `/api/retry_fix` re-attaches photos to a product that has **none**, from
  `images_by_product` ({product_id: [url, …]}) the frontend sends along. Before,
  it touched sales channels only — which is why "Retry fix" could never repair
  the "No images attached" it was being offered for.

---

## 🔎 Self-test endpoints — how the routine verifies its own fix

Everything behind `@require_droplet_token` is unreachable from a cloud session,
so the routine could fix a bug and then not be able to measure whether the fix
worked. Bug #31 stayed open for exactly that reason while the code was already
correct and the DataForSEO account healthy.

`GET /api/selftest?what=keywords|scraper_proxy` — ungated, read-only, returns an
**outcome only**:

```
curl "https://188-166-11-177.nip.io/api/selftest?what=keywords"
# {"ok":true,"found":12,"min_volume":1800,"store":"dk","product_type":"dress"}
curl "https://188-166-11-177.nip.io/api/selftest?what=scraper_proxy"
# {"ok":true,"message":"The proxy is carrying our competitor traffic."}
```

- Never returns keyword text, the proxy URL, our egress IPs, or raw exception
  text (a `requests` ProxyError can carry the proxy URL, credentials included).
  That is why it builds its own message instead of echoing the probe's.
- Cached 120s (`_SELFTEST_TTL`) so a retry loop can't burn DataForSEO credits.
- `?what=keywords` stops **before** the LLM cleaning step that
  `/api/keyword_research_niche` runs. That's deliberate: `found > 0` here but
  nothing in the UI means the cleaner is eating the results, not the API.
- `ok:false` **with** `error` = upstream failure; `ok:false` **without** = the
  market genuinely has nothing above the threshold. Conflating those two is what
  bug #31 was reported for.

Other ungated checks worth knowing: `/api/health`, `/api/version`,
`/api/scraper_proxy_status`, `/api/keyword_research_status?probe=1` (calls
DataForSEO and reports account + balance), and `/api/bestseller_scan?domain=X`
(the real end-to-end proof that competitor access works).

Deliberately **not** done: handing the routine a session token. It reads
untrusted input — scraped competitor HTML and bug reports typed by others — so a
credential it holds is something a prompt injection can try to aim. These
endpoints have nothing worth stealing. `/api/plans/<id>/approve` must never
become reachable to the routine either; it would let it approve its own plans.

---

## 📋 Plans: the approval loop for feature requests

The hands-off pipeline distinguishes two kinds of reports:
- **Clear code bug** → the fix routine repairs it directly (PR + auto-merge on
  green CI). No human in the loop.
- **Feature request / judgement call** → the routine must NOT build. It POSTs a
  plan to `POST /api/plans` (`{bug_id, title, summary, plan}`); the droplet
  Slack-pings the CEO with the summary. The CEO approves/rejects in the
  dashboard (**Tools → Plans**). Approving (token-gated) fires the routine again
  with the plan text in "APPROVED PLAN" mode — it then builds exactly that plan,
  opens a PR with auto-merge, and resolves the bug.
- Plan storage: `backend/plans.jsonl` (gitignored, droplet-only).
- The routine's cloud environment needs network access to the droplet
  (`188-166-11-177.nip.io`) for the plan POST + resolve calls; if unreachable it
  falls back to a draft PR describing the plan.
