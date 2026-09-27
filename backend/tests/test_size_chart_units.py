# -*- coding: utf-8 -*-
"""Size charts reach the store as ONE block, in cm.

venek, 2026-09-27: "Sizecharts staan er dubbel in" — Ruth/Antonie/Olive… held
XS..XL in inches AND XS..XL in cm (the competitor's table had both, the theme
converts to inches itself under its CM/TOMMER toggle). Iris/Helga… held an
inch-only table under the CM tab.
"""
import server

RUTH = {'headers': ['Size', 'US', 'Shoulder', 'Bust', 'Sleeve', 'Length'],
        'rows': [['XS', '2', '18.7', '48.0', '22.6', '23.6'], ['S', '4', '19.1', '49.6', '23.0', '24.0'],
                 ['M', '6', '19.5', '51.2', '23.4', '24.4'], ['L', '8/10', '20.1', '53.5', '23.8', '24.8'],
                 ['XL', '12', '20.7', '55.9', '24.2', '25.2'],
                 ['XS', '2', '47.5', '122', '57.5', '60'], ['S', '4', '48.5', '126', '58.5', '61'],
                 ['M', '6', '49.5', '130', '59.5', '62'], ['L', '8/10', '51', '136', '60.5', '63'],
                 ['XL', '12', '52.5', '142', '61.5', '64']]}


def test_a_doubled_table_keeps_only_the_cm_block():
    out, fix = server._size_chart_normalise(RUTH)
    assert fix == 'dedup'
    assert [r[0] for r in out['rows']] == ['XS', 'S', 'M', 'L', 'XL']
    assert out['rows'][0] == ['XS', '2', '47.5', '122', '57.5', '60']
    assert out['unit_fix'] == 'dedup' and RUTH['rows'][0][2] == '18.7'      # input untouched


def test_the_cm_block_wins_whichever_comes_first():
    swapped = {'headers': RUTH['headers'], 'rows': RUTH['rows'][5:] + RUTH['rows'][:5]}
    out, fix = server._size_chart_normalise(swapped)
    assert fix == 'dedup' and out['rows'][0][3] == '122'


def test_an_inch_only_table_is_converted_to_cm_and_size_codes_stay():
    iris = {'headers': ['Size', 'US', 'Shoulder', 'Bust', 'Length'],
            'rows': [['XS', '2', '14.2', '32.3-33.9', '24.4'], ['S', '4', '14.6', '33.9-35.4', '24.8'],
                     ['M', '6', '15', '35.4-37', '25.2'], ['L', '8/10', '15.4', '37-39.4', '25.6'],
                     ['XL', '12', '15.7', '39.4-41.7', '26']]}
    out, fix = server._size_chart_normalise(iris)
    assert fix == 'inches'
    assert out['rows'][0] == ['XS', '2', '36', '82-86', '62']
    assert out['rows'][3][1] == '8/10'                     # US column untouched


def test_a_cm_table_is_left_alone():
    cm = {'headers': ['Størrelse', 'US', 'Bryst', 'Talje', 'Hofte'],
          'rows': [['XS', '2', '82-86', '62-66', '88-92'], ['S', '4', '86-90', '66-70', '92-96'],
                   ['M', '6', '90-94', '70-74', '96-100']]}
    out, fix = server._size_chart_normalise(cm)
    assert fix is None and out is cm


def test_extended_sizes_are_not_a_duplicate_block():
    ext = {'headers': ['Size', 'Bust', 'Hip'],
           'rows': [['S', '86', '92'], ['M', '90', '96'], ['L', '94', '100'], ['XL', '100', '106'],
                    ['2XL', '106', '112'], ['3XL', '112', '118']]}
    assert server._size_chart_normalise(ext)[1] is None


def test_a_size_conversion_table_without_measurements_is_left_alone():
    conv = {'headers': ['Størrelse', 'AUS', 'US', 'UK'],
            'rows': [['XS', '6', '2', '6'], ['S', '8', '4', '8'], ['M', '10', '6', '10'], ['L', '12', '8', '12']]}
    assert server._size_chart_normalise(conv)[1] is None


def test_headers_decide_when_a_column_is_a_size_code_and_units_in_headers_count():
    inch_hdr = {'headers': ['Size', 'Bust (in)', 'Waist (in)'],
                'rows': [['S', '34', '26'], ['M', '36', '28'], ['L', '38', '30']]}
    out, fix = server._size_chart_normalise(inch_hdr)
    assert fix == 'inches' and out['headers'] == ['Size', 'Bust (cm)', 'Waist (cm)'] and out['rows'][0][1] == '86'
    cm_hdr = {'headers': ['Size', 'Sleeve (cm)', 'Shoulder (cm)'],
              'rows': [['S', '58', '40'], ['M', '59', '41'], ['L', '60', '42']]}
    assert server._size_chart_normalise(cm_hdr)[1] is None      # 'cm' in the header: never converted


def test_unit_marker_rows_are_dropped_and_garbage_never_raises():
    marked = {'headers': ['Size', 'Bust'], 'rows': [['inch', ''], ['S', '34'], ['M', '36'], ['L', '38']]}
    out, fix = server._size_chart_normalise(marked)
    assert fix == 'inches' and [r[0] for r in out['rows']] == ['S', 'M', 'L']
    assert server._size_chart_normalise({'rows': 'nope'})[1] is None
    assert server._size_chart_normalise(None) == (None, None)


def test_html_round_trip_and_every_entry_normalises():
    html = server._chart_table_html(RUTH['headers'], RUTH['rows'])
    back = server._size_chart_from_html(html)
    assert back['headers'] == RUTH['headers'] and back['rows'] == RUTH['rows']
    fixed, fix = server._size_chart_normalise(back)
    assert fix == 'dedup' and len(fixed['rows']) == 5
    # _size_chart_html (publish + heal) emits one block
    out = server._size_chart_html(RUTH, 'dk')
    assert out.count('<tr>') == 6 and '18.7' not in out and '47.5' in out


def test_extract_full_normalises_whatever_reader_found(monkeypatch):
    monkeypatch.setattr(server, '_extract_size_chart', lambda html: {'headers': RUTH['headers'], 'rows': list(RUTH['rows'])})
    c = server._extract_size_chart_full('<html></html>', 'https://x/products/y')
    assert len(c['rows']) == 5 and c['unit_fix'] == 'dedup'


def test_unit_audit_rewrites_only_what_needs_it(monkeypatch):
    dup_html = server._chart_table_html(RUTH['headers'], RUTH['rows'])
    ok_html = server._chart_table_html(['Size', 'Bust'], [['S', '86'], ['M', '90'], ['L', '94']])
    products = [{'id': 'gid://shopify/Product/1', 'legacyResourceId': '1', 'handle': 'ruth-sort', 'title': 'Ruth',
                 'status': 'ACTIVE', 'metafield': {'value': dup_html}},
                {'id': 'gid://shopify/Product/2', 'legacyResourceId': '2', 'handle': 'fine', 'title': 'Fine',
                 'status': 'ACTIVE', 'metafield': {'value': ok_html}},
                {'id': 'gid://shopify/Product/3', 'legacyResourceId': '3', 'handle': 'none', 'title': 'None',
                 'status': 'ACTIVE', 'metafield': None}]
    writes = []

    class R:
        def __init__(self, body):
            self.body = body

        def json(self):
            return self.body

    def call(method, url, hdrs, json=None, timeout=45):
        if 'metafieldsSet' in json['query']:
            writes.extend(json['variables']['mf'])
            return R({'data': {'metafieldsSet': {'userErrors': []}}})
        return R({'data': {'products': {'pageInfo': {'hasNextPage': False, 'endCursor': None},
                                        'edges': [{'node': p} for p in products]}}})
    monkeypatch.setattr(server, '_shopify_call', call)
    monkeypatch.setattr(server, 'shopify_headers', lambda st: {})
    dry = server._size_chart_unit_audit('dk', apply=False)
    assert dry['scanned'] == 3 and dry['with_chart'] == 2 and dry['to_fix'] == 1 and dry['dedup'] == 1 and writes == []
    rep = server._size_chart_unit_audit('dk', apply=True)
    assert rep['fixed'] == 1 and len(writes) == 1 and writes[0]['ownerId'] == 'gid://shopify/Product/1'
    assert '18.7' not in writes[0]['value'] and writes[0]['value'].count('<tr>') == 6


def test_a_transposed_shoe_table_is_never_treated_as_inches():
    shoes = {'headers': ['Fodlængde', '220', '225', '230', '235'], 'rows': [['Talje', '34', '35', '36', '37']]}
    assert server._size_chart_normalise(shoes)[1] is None
    eu = {'headers': ['EU', '36', '37', '38'], 'rows': [['UK', '3', '4', '5'], ['Foot (cm)', '23', '23.5', '24']]}
    assert server._size_chart_normalise(eu)[1] is None


def test_inch_marks_go_with_the_conversion_and_entities_are_read():
    html = ('<table><thead><tr><th>Størrelse</th><th>US Size</th><th>Skuldervidde</th><th>Brystmål</th></tr></thead>'
            '<tbody><tr><td>S</td><td>4</td><td>15.75&quot;</td><td>37.40&quot;</td></tr>'
            '<tr><td>M</td><td>6</td><td>16.14&quot;</td><td>39.37&quot;</td></tr>'
            '<tr><td>L</td><td>8</td><td>16.54&quot;</td><td>41.34&quot;</td></tr></tbody></table>')
    chart = server._size_chart_from_html(html)
    assert chart['rows'][0][2] == '15.75"'
    out, fix = server._size_chart_normalise(chart)
    assert fix == 'inches' and out['rows'][0] == ['S', '4', '40', '95'] and out['rows'][2][3] == '105'


def test_foot_length_and_bag_charts_are_never_converted():
    boots = {'headers': ['Størrelse EU', 'US', 'UK', 'Fodlængde'],
             'rows': [['35', '5', '2,5', '22.5'], ['36', '6', '3,5', '23'], ['37', '7', '4,5', '23.5']]}
    assert server._size_chart_normalise(boots)[1] is None
    bag = {'headers': ['Model', 'Bredde', 'Højde', 'Dybde'], 'rows': [['One size', '30', '40', '12']]}
    assert server._size_chart_normalise(bag)[1] is None
    # …while a body chart under 60 still is inches
    body = {'headers': ['Størrelse', 'US', 'Bryst', 'Talje'], 'rows': [['XS', '2', '32.3-33.9', '24.4-26'], ['S', '4', '33.9-35.4', '26-27.6'], ['M', '6', '35.4-37', '27.6-29.1']]}
    assert server._size_chart_normalise(body)[1] == 'inches'
