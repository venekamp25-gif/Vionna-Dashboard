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
