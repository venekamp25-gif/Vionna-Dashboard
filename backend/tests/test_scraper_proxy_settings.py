"""Tests for the dashboard-side scraper-proxy settings (plan #3 follow-up).

Configuring the proxy used to mean SSH-ing into the droplet and editing .env by
hand, so bug #35 sat unfixed while the code to fix it was already deployed.
These routes move it into the Settings form. Because the form now writes server
config, the security properties matter as much as the happy path: the value is
never echoed back, never logged, cannot inject extra .env keys, and cannot touch
a key outside the allowlist.
"""
import os

import pytest

import server


@pytest.fixture(autouse=True)
def _env_sandbox(tmp_path, monkeypatch):
    """Point .env writing at tmp_path and start from a clean environment."""
    monkeypatch.setattr(server, 'ENV_PATH', str(tmp_path / '.env'))
    monkeypatch.delenv('SCRAPER_PROXY_URL', raising=False)
    monkeypatch.delenv('SCRAPER_PROXY', raising=False)
    monkeypatch.setenv('DEV_LOCAL', '1')          # open the token gate for tests
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', '')
    # Never let the tests reach the real ipify endpoint.
    monkeypatch.setattr(server, '_egress_ip', lambda through_proxy, timeout=8:
                        '5.5.5.5' if through_proxy else '1.2.3.4')
    return tmp_path


@pytest.fixture()
def client():
    server.app.config['TESTING'] = True
    with server.app.test_client() as c:
        yield c


def _env_text(tmp_path):
    p = tmp_path / '.env'
    return p.read_text(encoding='utf-8') if p.exists() else ''


PROXY = 'http://user:secret@gateway.example.net:8080'


def test_saving_a_proxy_persists_and_applies_it_live(client, _env_sandbox):
    r = client.post('/api/save_scraper_proxy', json={'proxy_url': PROXY})

    assert r.status_code == 200
    body = r.get_json()
    assert body['ok'] is True and body['configured'] is True
    # Applied to the running process — no restart needed, because
    # _scraper_proxies reads os.getenv on every request.
    assert os.environ['SCRAPER_PROXY_URL'] == PROXY
    assert server._scraper_proxies('https://shop.example/products/x.json') == {
        'http': PROXY, 'https': PROXY}
    # And persisted for the next restart.
    assert f'SCRAPER_PROXY_URL={PROXY}' in _env_text(_env_sandbox)


def test_the_secret_is_never_returned(client):
    r = client.post('/api/save_scraper_proxy', json={'proxy_url': PROXY})

    assert 'secret' not in r.get_data(as_text=True)
    assert r.get_json()['host_hint'] == 'gateway.example.net:8080'


def test_status_never_leaks_the_url(client, monkeypatch):
    monkeypatch.setenv('SCRAPER_PROXY_URL', PROXY)

    r = client.get('/api/scraper_proxy_status')

    assert 'secret' not in r.get_data(as_text=True)
    body = r.get_json()
    assert body['configured'] is True
    assert body['enabled'] is True
    assert body['host_hint'] == 'gateway.example.net:8080'


def test_status_tells_kill_switch_apart_from_unset(client, monkeypatch):
    """/api/health could not distinguish these two, which cost real debugging
    time on bug #35."""
    monkeypatch.setenv('SCRAPER_PROXY_URL', PROXY)
    monkeypatch.setenv('SCRAPER_PROXY', '0')

    body = client.get('/api/scraper_proxy_status').get_json()

    assert body['configured'] is True      # a URL IS set...
    assert body['enabled'] is False        # ...but the kill switch is on
    assert body['kill_switch'] is True


def test_a_newline_cannot_inject_extra_env_keys(client, _env_sandbox):
    """A newline in the value must not reach .env.

    Caught a real hole while writing this: the first version *stripped* CR/LF,
    which glued the payload onto the URL ('...:8080ANTHROPIC_API_KEY=stolen')
    and wrote that into .env as one corrupt line. Rejecting is the fix — a proxy
    URL with a line break is simply invalid.
    """
    attack = PROXY + '\nANTHROPIC_API_KEY=stolen'

    r = client.post('/api/save_scraper_proxy', json={'proxy_url': attack})

    assert r.status_code == 400
    assert 'ANTHROPIC_API_KEY' not in _env_text(_env_sandbox)
    assert 'SCRAPER_PROXY_URL' not in os.environ


def test_a_malformed_port_is_rejected(client):
    """urlparse().hostname happily accepts '8080junk' as a port; .port raises."""
    r = client.post('/api/save_scraper_proxy',
                    json={'proxy_url': 'http://user:p@gateway.example.net:8080junk'})

    assert r.status_code == 400


def test_env_write_refuses_keys_outside_the_allowlist():
    with pytest.raises(ValueError):
        server._env_write({'ANTHROPIC_API_KEY': 'nope'})


def test_garbage_is_rejected(client):
    for bad in ('not a url', 'file:///etc/passwd', 'socks5://host:1080', 'http://'):
        r = client.post('/api/save_scraper_proxy', json={'proxy_url': bad})
        assert r.status_code == 400, f'{bad!r} should be rejected'


def test_clearing_removes_the_proxy(client, _env_sandbox, monkeypatch):
    client.post('/api/save_scraper_proxy', json={'proxy_url': PROXY})

    r = client.post('/api/save_scraper_proxy', json={'proxy_url': ''})

    assert r.get_json()['configured'] is False
    assert 'SCRAPER_PROXY_URL' not in os.environ
    assert 'SCRAPER_PROXY_URL' not in _env_text(_env_sandbox)
    assert server._scraper_proxies('https://shop.example/x.json') is None


def test_kill_switch_can_be_set_from_the_form(client, _env_sandbox):
    r = client.post('/api/save_scraper_proxy', json={'proxy_url': PROXY, 'enabled': False})

    assert r.get_json()['enabled'] is False
    assert os.environ['SCRAPER_PROXY'] == '0'
    assert server._scraper_proxies('https://shop.example/x.json') is None
    assert 'kill switch' in r.get_json()['message']


def test_a_proxy_that_does_not_change_our_ip_is_reported_as_broken(client, monkeypatch):
    """The dangerous silent failure: _scrape_request falls back to a direct
    request, so a wrong password looks like success unless we check the IP."""
    monkeypatch.setattr(server, '_egress_ip', lambda through_proxy, timeout=8: '1.2.3.4')

    body = client.post('/api/save_scraper_proxy', json={'proxy_url': PROXY}).get_json()

    assert body['verified'] is False
    assert 'did NOT change our IP' in body['message']


def test_a_working_proxy_is_reported_as_verified(client):
    body = client.post('/api/save_scraper_proxy', json={'proxy_url': PROXY}).get_json()

    assert body['verified'] is True
    assert '5.5.5.5' in body['message']


def test_saving_requires_the_token_when_a_secret_is_set(client, monkeypatch):
    """The gate is what keeps a public endpoint from accepting credentials from
    anyone on the internet."""
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', 'a-secret')
    monkeypatch.delenv('DEV_LOCAL', raising=False)

    r = client.post('/api/save_scraper_proxy', json={'proxy_url': PROXY})

    assert r.status_code == 401
