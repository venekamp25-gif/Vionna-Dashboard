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
  are gitignored and live only on the droplet.

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
   - **Cloud / web session:** make the change on a branch and open a PR; tell the
     user to tap **Merge** to go live. (Marking resolved can wait for the next
     laptop session, or do it if the droplet API is reachable.)
5. Always show what changed before it goes live; never merge/deploy on the user's
   behalf without the change being visible to them.

Notes:
- The bug queue + Slack ping are handled entirely by the droplet; Claude does NOT
  need any Slack access — only the GitHub repo + (when reachable) the public API.
- Data-mutation tasks that need live Shopify tokens (`tokens.json`) only work from
  the laptop, not cloud sessions.

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
