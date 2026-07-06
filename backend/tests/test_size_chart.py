"""Regression test for bug #9: a Vitals-app size-chart image was undetectable
because its CDN (cdn-sc.vitals.app) serves WebP bytes under a mislabeled
'image/jpeg' Content-Type header. _ocr_chart_image trusted that header
verbatim, so Claude vision got a media_type/bytes mismatch and silently
failed to read the chart. _sniff_image_mime sniffs the real format from the
file's magic bytes instead of trusting the header.
"""
import server


def test_sniff_image_mime_detects_real_type_over_bad_header():
    webp_bytes = b'RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00'
    assert server._sniff_image_mime(webp_bytes, fallback='image/jpeg') == 'image/webp'


def test_sniff_image_mime_detects_png_jpeg_gif():
    assert server._sniff_image_mime(b'\x89PNG\r\n\x1a\n' + b'\x00' * 10) == 'image/png'
    assert server._sniff_image_mime(b'\xff\xd8\xff' + b'\x00' * 10) == 'image/jpeg'
    assert server._sniff_image_mime(b'GIF89a' + b'\x00' * 10) == 'image/gif'


def test_sniff_image_mime_falls_back_when_unrecognized():
    assert server._sniff_image_mime(b'not-an-image', fallback='image/png') == 'image/png'
