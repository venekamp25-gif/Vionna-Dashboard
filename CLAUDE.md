# Vionna Dashboard — working notes for Claude

Product-import tool for the Vionna Shopify stores (Denmark + France). Scrapes a
competitor product, generates per-store content via Claude, makes model photos
via Higgsfield (Nano Banana), and publishes to Shopify with variants, metafields
and sales channels.

- Frontend: Next.js on Netlify — `frontend/` (auto-deploys on push to `main`)
- Backend: Python Flask on a DigitalOcean droplet — `backend/server.py`
  - Public base URL: `https://188-166-11-177.nip.io`
  - Self-updates from `main` (pulls `backend/server.py` + `version.txt`); bump
    `backend/version.txt` for any backend change so the droplet picks it up.
- Repo is PUBLIC — never commit secrets. `.env`, `tokens.json`, `slack_config.json`
  are gitignored and live only on the droplet.

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
