"""Regression test for bug #9: a Vitals-app size-chart image was undetectable
because its CDN (cdn-sc.vitals.app) serves WebP bytes under a mislabeled
'image/jpeg' Content-Type header. _ocr_chart_image trusted that header
verbatim, so Claude vision got a media_type/bytes mismatch and silently
failed to read the chart. _sniff_image_mime sniffs the real format from the
file's magic bytes instead of trusting the header.

Also covers bug #17: designbysi.dk has no size chart on the product page at
all — just a footer link ("Størrelsesguide") to a separate store page that
holds the actual table. _linked_page_size_chart follows that link and reads
the chart from the linked page instead.
"""
import server


PRODUCT_PAGE_WITH_SIZE_LINK = '''
<html><body>
<div class="product">no chart here</div>
<footer>
<li class="WI_footerLinkLI">
  <a
    href="/pages/storrelsesguide-1"

      class="no-wrap"

  >Størrelsesguide</a>
</li>
</footer>
</body></html>
'''

SIZE_GUIDE_PAGE_WITH_TABLE = '''
<html><body><article>
<table>
<tr><th>Size</th><th>Bust (cm)</th><th>Waist (cm)</th></tr>
<tr><td>XS</td><td>82</td><td>64</td></tr>
<tr><td>S</td><td>86</td><td>68</td></tr>
<tr><td>M</td><td>90</td><td>72</td></tr>
</table>
</article></body></html>
'''


class _FakeResponse:
    def __init__(self, status_code=200, text=''):
        self.status_code = status_code
        self.text = text


def test_linked_page_size_chart_follows_footer_link_and_reads_table(monkeypatch):
    calls = []

    def fake_scrape_get(url, timeout=10, **kwargs):
        calls.append(url)
        assert url == 'https://designbysi.dk/pages/storrelsesguide-1'
        return _FakeResponse(200, SIZE_GUIDE_PAGE_WITH_TABLE)

    monkeypatch.setattr(server, '_scrape_get', fake_scrape_get)
    chart = server._linked_page_size_chart(
        PRODUCT_PAGE_WITH_SIZE_LINK, 'https://designbysi.dk/products/some-product')

    assert calls == ['https://designbysi.dk/pages/storrelsesguide-1']
    assert chart == {
        'headers': ['Size', 'Bust (cm)', 'Waist (cm)'],
        'rows': [['XS', '82', '64'], ['S', '86', '68'], ['M', '90', '72']],
    }


def test_linked_page_size_chart_returns_none_without_a_size_link():
    chart = server._linked_page_size_chart(
        '<html><body>no relevant links here</body></html>',
        'https://example.com/products/x')
    assert chart is None


def test_linked_page_size_chart_ignores_anchor_placeholders(monkeypatch):
    def fail_scrape_get(*a, **kw):
        raise AssertionError('should not fetch a javascript:/# link')

    monkeypatch.setattr(server, '_scrape_get', fail_scrape_get)
    html = '<a href="#">Size Guide</a><a href="javascript:void(0)">Size Chart</a>'
    assert server._linked_page_size_chart(html, 'https://example.com/products/x') is None


def test_sniff_image_mime_detects_real_type_over_bad_header():
    webp_bytes = b'RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00'
    assert server._sniff_image_mime(webp_bytes, fallback='image/jpeg') == 'image/webp'


def test_sniff_image_mime_detects_png_jpeg_gif():
    assert server._sniff_image_mime(b'\x89PNG\r\n\x1a\n' + b'\x00' * 10) == 'image/png'
    assert server._sniff_image_mime(b'\xff\xd8\xff' + b'\x00' * 10) == 'image/jpeg'
    assert server._sniff_image_mime(b'GIF89a' + b'\x00' * 10) == 'image/gif'


def test_sniff_image_mime_falls_back_when_unrecognized():
    assert server._sniff_image_mime(b'not-an-image', fallback='image/png') == 'image/png'


# ---------------------------------------------------------------------------
# Bug #57: a HIDDEN size-guide button is not a size chart we failed to read.
#
# monaco-mode.fr (Minimog theme) renders a FoxKit size-chart button that is
# permanently display:none (`.m\:hidden{display:none}`) with nothing behind it:
# no <table> anywhere on the product page, no size-guide page on the shop, and
# the FoxKit app script that would reveal and fill the button is not loaded.
# _detect_size_chart_hint matched its label text anyway, so size_chart_status
# became 'unread' and the review step offered a "Notify" button for a chart that
# does not exist — which is how bug #57 was filed.
# ---------------------------------------------------------------------------

MONACO_HIDDEN_FOXKIT_BUTTON = '''
<html><body>
  <div class="m-product-option--label">
    <label class="option-label"><span class="option-label--title">Taille:</span></label>
      <button data-open-sizeguide class="foxkit-sizechart-button m:inline-flex m:items-center m:hidden">
        <svg viewBox="0 0 640 512"><path d="M0 0v56c0 4.42 3.58 8 8 8h16z"/></svg>
        <span class="foxkit-sizechart-button--label">Guide des tailles</span>
      </button>
  </div>
  <div class="m-collapsible--content" data-content hidden>
    <p>Lorsque des informations ou un guide des tailles sont disponibles,
       consultez-les sur cette fiche produit avant de commander.</p>
  </div>
</body></html>
'''

VISIBLE_SIZE_GUIDE_BUTTON = '''
<html><body>
  <button class="product-sizeguide-trigger">
    <span class="label">Guide des tailles</span>
  </button>
</body></html>
'''


def test_hidden_size_guide_button_is_not_reported_as_an_unread_chart():
    """The reported page: the only size-guide trigger is display:none and there is
    no chart behind it, so the hint must stay silent (status 'none', no Notify)."""
    assert server._detect_size_chart_hint(MONACO_HIDDEN_FOXKIT_BUTTON) is None


def test_visible_size_guide_button_is_still_reported():
    """A trigger the shopper can see may well open a JS-loaded chart from an app we
    don't read yet — that is still worth flagging."""
    assert server._detect_size_chart_hint(VISIBLE_SIZE_GUIDE_BUTTON) == 'size-guide link/button'


def test_visible_size_guide_link_is_still_reported():
    """Bug #17's footer link must keep reporting when _linked_page_size_chart fails."""
    assert server._detect_size_chart_hint(
        PRODUCT_PAGE_WITH_SIZE_LINK) == 'size-guide link/button'


def test_breakpoint_hidden_trigger_is_still_reported():
    """`md:hidden` hides the trigger at ONE width only — it is still a real chart."""
    assert server._detect_size_chart_hint(
        '<button class="md:hidden"><span>Size Guide</span></button>'
    ) == 'size-guide link/button'


def test_size_guide_prose_alone_is_not_a_chart():
    """Only a label that is nothing BUT the phrase counts; prose mentioning a size
    guide (an FAQ, a shipping note) must not raise the hint."""
    assert server._detect_size_chart_hint(
        '<p>When a size guide is available, consult it before ordering.</p>') is None


def test_size_guide_label_inside_script_is_not_a_chart():
    """Theme/app JSON often carries the label as a translation string."""
    assert server._detect_size_chart_hint(
        '<script>var t = {"sizeguide_label": "Size Guide"};</script>') is None


def test_known_app_marker_still_wins_over_a_hidden_button():
    """Ordering is unchanged: a named app is a better hint than the generic one."""
    assert server._detect_size_chart_hint(
        '<div>kiwiSizing</div>'
        '<button class="m:hidden"><span>Size Guide</span></button>'
    ) == 'Kiwi Sizing app'


def test_element_is_hidden_recognises_the_common_forms():
    assert server._element_is_hidden('<div hidden>')
    assert server._element_is_hidden('<div aria-hidden="true">')
    assert server._element_is_hidden('<div style="display: none">')
    assert server._element_is_hidden('<div style="visibility:hidden">')
    assert server._element_is_hidden('<button class="a m:hidden b">')
    assert server._element_is_hidden('<div class="visually-hidden">')


def test_element_is_hidden_does_not_over_match():
    assert not server._element_is_hidden('<div>')
    assert not server._element_is_hidden('<div class="md:hidden">')
    assert not server._element_is_hidden('<div aria-hidden="false">')
    assert not server._element_is_hidden('<div data-hidden="true">')
    # 'hidden' appearing only inside another attribute's value is not the attribute
    assert not server._element_is_hidden('<div data-target="hidden-panel">')
