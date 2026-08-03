"""Regression test for bug #34 (CEO-approved plan #2, optie 3).

Competitor shops rate-limit the droplet's datacentre IP, not our code. Bug #28
already made the 429 *message* friendly, but a friendlier error is not a fix:
the worker still landed on an error screen and the retry button just hits the
same refused IP again. The manual-paste fallback, however, fetches the product
from the worker's OWN browser — an IP those shops answer — so a rate-limited
import is one paste away from working.

GenerateStep therefore opens the paste modal by itself on a 429. That decision
hangs on one string comparison: the error text /api/scrape produced, wrapped by
`call()` in frontend/lib/api.ts, has to be recognised by RATE_LIMIT_PATTERN in
frontend/lib/scrapeError.ts. This test pins that contract from both ends, so
rewording the backend message (or the pattern) can't silently put the worker
back on the dead end.

There is no JS test runner in this repo (CI type-checks and builds the
frontend), hence the pattern is read out of the TS source and replayed through
Python's `re` — the two patterns are plain alternations with identical meaning
in both engines.
"""
import json
import re
from pathlib import Path

import server

FRONTEND = Path(__file__).resolve().parents[2] / 'frontend'
SCRAPE_ERROR_TS = FRONTEND / 'lib' / 'scrapeError.ts'
GENERATE_STEP_TSX = FRONTEND / 'components' / 'steps' / 'GenerateStep.tsx'

# How lib/api.ts (call(), the `if (!res.ok)` branch) turns a failed response
# into the Error message GenerateStep classifies. Kept in sync by hand — the
# assertions below only care about the shape, not the exact wording.
API_ERROR_TRUNCATION = 200


class _FakeResponse:
    def __init__(self, status_code=200, text='', headers=None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise server.req.exceptions.HTTPError(f'{self.status_code} Client Error')


def _ts_pattern(name):
    """Read an exported regex literal out of the TS source as a Python regex."""
    src = SCRAPE_ERROR_TS.read_text(encoding='utf-8')
    m = re.search(rf'export const {name}\s*=\s*/(.+?)/([a-z]*);', src, re.S)
    assert m, f'{name} not found in {SCRAPE_ERROR_TS.name}'
    flags = re.I if 'i' in m.group(2) else 0
    return re.compile(m.group(1), flags)


def _frontend_error_text(res):
    """Rebuild the exact Error message lib/api.ts throws for this response."""
    body = res.get_data(as_text=True)
    return f'API /api/scrape → {res.status_code}: {body[:API_ERROR_TRUNCATION]}'


def _scrape_429(monkeypatch, headers):
    def fake_scrape_get(url, timeout=10, **kwargs):
        return _FakeResponse(429, '{"error": "rate limited"}', headers=headers)

    monkeypatch.setattr(server, '_scrape_get', fake_scrape_get)
    monkeypatch.setenv('DEV_LOCAL', '1')
    client = server.app.test_client()
    return client.post('/api/scrape', json={'url': 'https://murci.co.uk/products/isola-brown'})


def test_real_429_message_is_classified_as_rate_limit(monkeypatch):
    # Retry-After 60 is what murci.co.uk sent while bug #34 was open.
    res = _scrape_429(monkeypatch, {'Retry-After': '60'})
    assert res.status_code == 429

    message = _frontend_error_text(res)
    assert _ts_pattern('RATE_LIMIT_PATTERN').search(message), (
        'the 429 the worker actually gets is no longer recognised as a '
        f'rate-limit by the frontend, so the paste step will not open: {message}'
    )


def test_cooldown_429_without_retry_after_also_opens_the_paste_step(monkeypatch):
    # The synthetic 429 _scrape_get returns while a host is in cooldown
    # (server.py:_scrape_429_cooldown_response) must reach the same escape hatch.
    res = _scrape_429(monkeypatch, {})
    message = _frontend_error_text(res)
    assert _ts_pattern('RATE_LIMIT_PATTERN').search(message)


def test_ordinary_failures_do_not_hijack_the_screen():
    """Only the shop refusing our IP may auto-open the paste modal — a genuine
    dashboard error must still be shown as an error."""
    pattern = _ts_pattern('RATE_LIMIT_PATTERN')
    for benign in (
        'API /api/generate → 500: {"error": "Claude request failed"}',
        'API /api/scrape → 404: {"error": "That product URL does not exist."}',
        'Failed to fetch',
    ):
        assert not pattern.search(benign), benign


def test_generate_step_opens_the_paste_modal_on_a_rate_limit():
    """The classification is only worth anything if GenerateStep acts on it."""
    src = GENERATE_STEP_TSX.read_text(encoding='utf-8')
    acted_on = [
        line for line in src.splitlines()
        if 'classifyScrapeError' in line and 'setManualPasteOpen(true)' in line
    ]
    assert acted_on, (
        'GenerateStep no longer opens the manual-paste modal from the scrape '
        'failure path — a rate-limited import is back to being a dead end.'
    )
