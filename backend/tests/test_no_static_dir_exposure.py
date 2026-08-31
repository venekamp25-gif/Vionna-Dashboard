"""Regression test for the backend-directory exposure (audit 2026-08-31).

`app = Flask(__name__, static_folder='.')` made Flask derive
static_url_path='/.' and register an UNGATED route `/./<path:filename>` over
the backend directory. Live on the production droplet that meant
`curl --path-as-is https://<host>/./tokens.json` returned the Shopify Admin
tokens of six stores, plus .env with ANTHROPIC_API_KEY and
DROPLET_TOKEN_SECRET — the secret that signs the very tokens
`@require_droplet_token` checks.

The gate is fine; the key was lying next to the door. These tests fail if
anyone ever re-adds a static folder over a directory that holds secrets.
"""
import server


def test_app_has_no_static_folder():
    assert server.app.static_folder is None, (
        "static_folder must stay None — any value makes Flask serve that whole "
        "directory over an ungated route (backend/ holds .env and tokens.json)"
    )


def test_no_route_serves_the_backend_directory():
    """No rule may accept an arbitrary path directly under the app root."""
    leaking = [
        str(rule) for rule in server.app.url_map.iter_rules()
        if rule.endpoint == 'static' or str(rule).startswith('/./')
    ]
    assert leaking == [], f"route(s) serving the backend directory: {leaking}"


def test_secret_files_are_not_reachable_over_http():
    """End-to-end proof: the paths that leaked must 404, in every spelling."""
    client = server.app.test_client()
    for path in ('/./tokens.json', '/./.env', '/./lighting_tokens.json',
                 '/./requirements.txt', '/tokens.json', '/.env'):
        assert client.get(path).status_code == 404, f"{path} is still served"


def test_index_is_still_served():
    """The one thing that legitimately needs the app root keeps working."""
    resp = server.app.test_client().get('/')
    assert resp.status_code == 200
    assert b'<' in resp.data
