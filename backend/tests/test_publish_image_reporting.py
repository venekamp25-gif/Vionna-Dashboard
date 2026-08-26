"""Publish must never report a clean result for photos that did not attach.

Bug #45: ten products were published with ZERO photos while every publish call
returned success and publish_history.jsonl logged image_count=4. Nothing along
the attach path lied — it simply said nothing. Every failure was a print() on
the droplet, which is the one place neither the operator nor the hands-off
routine can read, so "Retry fix" had nothing to work with and the operator was
told the run was fine.

These tests pin the reporting, not the attaching: the plan (#8) deliberately
stops before touching how photos get uploaded, because the reason those eight
URLs would not download is only visible in the droplet log. What must hold is
that the NEXT occurrence names its own cause.
"""
import pytest

import server


class _Resp:
    """Minimal stand-in for a requests Response."""

    def __init__(self, status_code=200, content=b'', text=''):
        self.status_code = status_code
        self.content = content
        self.text = text

    def json(self):
        return {'image': {'id': 987, 'src': 'https://cdn.shopify.com/x.jpg'}}

    def raise_for_status(self):
        if self.status_code >= 400:
            err = server.req.exceptions.HTTPError(f'{self.status_code} error')
            err.response = self
            raise err


PNG = b'\x89PNG\r\n\x1a\n' + b'x' * 64
URL = 'https://images.higgsfield.ai/out/abc123.png?signature=SECRET-TOKEN'


# --- Step A: a download that fails must be REPORTED ------------------------

def test_a_failed_download_is_reported_instead_of_swallowed(monkeypatch):
    """Today's behaviour: the URL silently becomes {'src': url}, Shopify says
    201, and the product ends up with no photo. The fallback stays (Shopify may
    still fetch it) but it must no longer pass for success."""
    def _dead(url, timeout=20):
        return _Resp(status_code=403, text='Forbidden')

    monkeypatch.setattr(server, '_scrape_get', _dead)
    report = server._new_image_report()

    payload = server._build_image_payload([URL], report=report)

    assert payload == [{'src': URL}], 'the src fallback itself must stay'
    assert report['requested'] == 1
    assert report['verified'] == 0, 'a download we never made is not a photo'
    assert len(report['errors']) == 1
    assert 'HTTP 403' in report['errors'][0]


def test_the_reason_survives_when_there_is_no_http_status(monkeypatch):
    """403/404/429 is the useful case, but a connection that never got that far
    must still say something better than nothing."""
    def _timeout(url, timeout=20):
        raise server.req.exceptions.ConnectTimeout('connection to host timed out')

    monkeypatch.setattr(server, '_scrape_get', _timeout)
    report = server._new_image_report()

    server._build_image_payload([URL], report=report)

    assert 'did not answer in time' in report['errors'][0]


def test_an_empty_response_body_is_reported_as_such(monkeypatch):
    """A 200 with no bytes is the sneakiest case: raise_for_status is happy."""
    monkeypatch.setattr(server, '_scrape_get', lambda url, timeout=20: _Resp(content=b''))
    report = server._new_image_report()

    server._build_image_payload([URL], report=report)

    assert 'empty or oversized image' in report['errors'][0]
    assert report['verified'] == 0


def test_a_working_download_reports_no_problem(monkeypatch):
    monkeypatch.setattr(server, '_scrape_get', lambda url, timeout=20: _Resp(content=PNG))
    report = server._new_image_report()

    payload = server._build_image_payload([URL], report=report)

    assert 'attachment' in payload[0]
    assert report == {'requested': 1, 'verified': 0, 'errors': []}, \
        'nothing is verified until Shopify has accepted it'


# --- The reports are read by humans and stored: no secrets in them ---------

def test_report_never_carries_proxy_credentials_or_signed_query(monkeypatch):
    """image_errors goes into the publish response AND publish_history.jsonl.

    The scraper proxy fetches these images, and a requests ProxyError carries
    the proxy URL with its credentials (same trap as _proxy_failure_hint). The
    image URLs themselves are signed. Neither may end up in the report.
    """
    def _proxy_boom(url, timeout=20):
        raise server.req.exceptions.ProxyError(
            'HTTPSConnectionPool: Cannot connect to proxy '
            'http://vionna-user:hunter2@gate.provider.net:7000')

    monkeypatch.setattr(server, '_scrape_get', _proxy_boom)
    report = server._new_image_report()

    server._build_image_payload([URL], report=report)

    blob = ' '.join(report['errors'])
    for secret in ('hunter2', 'vionna-user', 'gate.provider.net', 'SECRET-TOKEN'):
        assert secret not in blob, f'{secret!r} leaked into an operator-visible report'
    assert 'images.higgsfield.ai/out/abc123.png' in blob, 'but WHICH photo must still be clear'


# --- Step A: a non-2xx upload must be REPORTED -----------------------------

def _post_returning(monkeypatch, *responses):
    calls = iter(responses)
    monkeypatch.setattr(server, 'shopify_url', lambda store, path: f'https://x/{path}')
    monkeypatch.setattr(server.req, 'post',
                        lambda *a, **kw: next(calls))


def test_a_rejected_upload_is_reported(monkeypatch):
    """_attach_images_one_by_one dropped a non-2xx on the floor with a print()."""
    _post_returning(monkeypatch, _Resp(status_code=422, text='image is invalid'))
    report = server._new_image_report()

    created = server._attach_images_one_by_one(
        'dk', 111, [{'attachment': 'AAA', 'filename': 'a.jpg'}], {}, report=report)

    assert created == []
    assert report['verified'] == 0
    assert 'HTTP 422' in report['errors'][0]


def test_an_accepted_attachment_counts_as_verified(monkeypatch):
    _post_returning(monkeypatch, _Resp(status_code=201))
    report = server._new_image_report()

    created = server._attach_images_one_by_one(
        'dk', 111, [{'attachment': 'AAA', 'filename': 'a.jpg'}], {}, report=report)

    assert len(created) == 1
    assert report['verified'] == 1
    assert report['errors'] == []


def test_an_accepted_src_fallback_does_not_count_as_verified(monkeypatch):
    """The heart of bug #45. Shopify answers 201 to a {'src': ...} POST and
    fetches the URL later — or never. The image object still comes back (the
    caller needs its id for the variant), but it is not proof of a photo."""
    _post_returning(monkeypatch, _Resp(status_code=201))
    report = server._new_image_report()
    report['requested'] = 1

    created = server._attach_images_one_by_one(
        'dk', 111, [{'src': URL}], {}, report=report)

    assert len(created) == 1, 'the caller still needs the image id'
    assert report['verified'] == 0, 'nothing about an async fetch is verified'


# --- Step B: the summary line the operator and the logbook get -------------

def test_zero_verified_photos_produces_a_headline_error():
    report = {'requested': 4, 'verified': 0, 'errors': ['photo 1 (…): could not be downloaded']}

    errs = server._image_report_errors(report)

    assert 'NO photos are confirmed' in errs[0]
    assert '0 of 4' in errs[0]
    assert errs[1].startswith('photo 1')


def test_a_partial_attach_says_how_partial():
    errs = server._image_report_errors({'requested': 4, 'verified': 3, 'errors': ['x']})

    assert '3 of 4' in errs[0]


def test_a_fully_attached_product_reports_nothing():
    assert server._image_report_errors({'requested': 4, 'verified': 4, 'errors': []}) == []


def test_a_product_published_without_photos_is_not_an_error():
    """Publishing with no images at all is a legitimate choice, not a failure."""
    assert server._image_report_errors({'requested': 0, 'verified': 0, 'errors': []}) == []
