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

## 🛡️ Spy Shield beacon (since v1.314.0, hardened in v1.315.0)

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
