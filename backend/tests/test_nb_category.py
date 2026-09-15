"""Nano Banana image steps: accessories get their own category + prompt set.

Jewellery, sunglasses, belts, hats, scarves, watches, gloves and hair
accessories used to fall through to the GARMENT set — a "back view" that hides
a necklace, a "full-body shot" of a ring, "fabric texture" of a pair of
sunglasses — and FR "bague" (a ring) even matched the "bag" substring and was
told to carry the bague on the shoulder.

The classification lives on both sides (frontend labels, backend prompts), so
CASES below is THE SAME list as in frontend/tests/nbCategory.test.ts: change
one, change both.
"""
import pytest

import server


CASES = [
    # garments
    ("dress", "garment", None),
    ("blouse", "garment", None),
    ("Vaatteet", "garment", None),
    ("spring dress", "garment", None),          # "ring" only as a whole word
    ("belted midi dress", "garment", None),     # "belt" only as a whole word
    ("cap sleeve dress", "garment", None),      # descriptor stripped
    ("scarf print dress", "garment", None),
    ("kellohame", "garment", None),             # FI bell skirt != kello (watch)
    ("korkea vyötärö housut", "garment", None), # FI high-waist != vyö (belt)
    ("bootcut jeans", "garment", None),
    ("pantalon", "garment", None),              # no "talon" (heel) in it
    ("veste bouclée", "garment", None),         # != boucle d'oreille
    ("oxford shirt", "garment", None),
    ("", "garment", None),
    # shoes
    ("sneakers", "shoes", None),
    ("støvler", "shoes", None),
    ("cap toe boots", "shoes", None),
    # bags
    ("tote bag", "bag", None),
    ("sac à main", "bag", None),
    ("belt bag", "bag", None),                  # compound bag wins over "belt"
    ("skoletaske", "bag", None),                # contains 'sko' and 'taske'
    ("baguette bag", "bag", None),
    # jewellery
    ("bague", "accessory", "ring"),             # FR ring — contains "bag"
    ("ring", "accessory", "ring"),
    ("earrings", "accessory", "jewelry"),
    ("earring", "accessory", "jewelry"),        # not the whole-word "ring"
    ("øreringe", "accessory", "jewelry"),
    ("boucles d'oreilles", "accessory", "jewelry"),
    ("collier", "accessory", "jewelry"),
    ("kaulakoru", "accessory", "jewelry"),
    ("ketting", "accessory", "jewelry"),
    ("Halskette", "accessory", "jewelry"),
    ("sormus", "accessory", "ring"),
    ("guldring", "accessory", "ring"),          # DK compound
    ("Armbånd guld", "accessory", "bracelet"),
    ("bracelet", "accessory", "bracelet"),
    ("ring-spun cotton tee", "garment", None),  # noise, not a ring
    ("toe ring sandals", "shoes", None),
    ("d-ring belt", "accessory", "belt"),
    ("chain strap bag", "bag", None),
    ("cœur pendant", "accessory", "jewelry"),   # œ must not split the word (JS side)
    # eyewear
    ("sunglasses", "accessory", "eyewear"),
    ("solbriller", "accessory", "eyewear"),
    ("lunettes de soleil", "accessory", "eyewear"),
    ("aurinkolasit", "accessory", "eyewear"),
    ("zonnebril", "accessory", "eyewear"),
    ("Sonnenbrille", "accessory", "eyewear"),
    # watches
    ("watch", "accessory", "watch"),
    ("montre", "accessory", "watch"),
    ("rannekello", "accessory", "watch"),
    ("armbåndsur", "accessory", "watch"),       # watch before bracelet
    # belts
    ("belt", "accessory", "belt"),
    ("bælte", "accessory", "belt"),
    ("ceinture", "accessory", "belt"),
    ("vyö", "accessory", "belt"),
    ("riem", "accessory", "belt"),
    ("Gürtel", "accessory", "belt"),
    # scarves
    ("scarf", "accessory", "scarf"),
    ("tørklæde", "accessory", "scarf"),
    ("huivi", "accessory", "scarf"),
    # headwear
    ("hat", "accessory", "headwear"),
    ("chapeau", "accessory", "headwear"),
    ("pipo", "accessory", "headwear"),
    ("hoed", "accessory", "headwear"),
    ("Mütze", "accessory", "headwear"),
    # gloves
    ("gloves", "accessory", "gloves"),
    ("handschoenen", "accessory", "gloves"),
    # hair
    ("hair clip", "accessory", "hair"),
    ("hiuspinni", "accessory", "hair"),
    ("chouchou", "accessory", "hair"),
    ("scrunchie", "accessory", "hair"),
    # generic
    ("accessoire", "accessory", "other"),
]

KEYS = [1, 2, 3, 4, 5, 11, 12, 13, 14]
KINDS = ['jewelry', 'bracelet', 'ring', 'eyewear', 'headwear', 'scarf', 'belt', 'watch', 'gloves', 'hair', 'other']
# Wording that belongs to the garment set and must never reach an accessory prompt.
FORBIDDEN = ('fabric', 'garment', 'full-body', 'back view', 'outfit')


@pytest.mark.parametrize('product_type, category, kind', CASES)
def test_category_matches_the_frontend_case_list(product_type, category, kind):
    assert server._nb_category(product_type) == category
    if kind is not None:
        assert server._nb_accessory_kind(product_type) == kind


def test_non_accessory_kind_is_other():
    assert server._nb_accessory_kind('dress') == 'other'
    assert server._nb_accessory_kind('tote bag') == 'other'


def test_prompt_set_selection():
    assert server._nb_prompts_for('bague') is server.NANO_BANANA_PROMPTS_ACCESSORY
    assert server._nb_prompts_for('sunglasses') is server.NANO_BANANA_PROMPTS_ACCESSORY
    assert server._nb_prompts_for('tote bag') is server.NANO_BANANA_PROMPTS_BAGS
    assert server._nb_prompts_for('sneakers') is server.NANO_BANANA_PROMPTS_SHOES
    assert server._nb_prompts_for('dress') is server.NANO_BANANA_PROMPTS
    assert server._nb_prompts_for('') is server.NANO_BANANA_PROMPTS


def test_accessory_set_has_the_same_keys_as_the_other_sets():
    assert sorted(server.NANO_BANANA_PROMPTS_ACCESSORY) == KEYS
    assert sorted(server.NANO_BANANA_PROMPTS) == KEYS
    assert sorted(server.NANO_BANANA_PROMPTS_SHOES) == KEYS
    assert sorted(server.NANO_BANANA_PROMPTS_BAGS) == KEYS


@pytest.mark.parametrize('key', KEYS)
def test_accessory_template_formats_and_avoids_garment_wording(key):
    tpl = server.NANO_BANANA_PROMPTS_ACCESSORY[key]
    out = tpl.format(product_type='necklace', color='gold', framing='FRAMING',
                     face='FACE', materials='MATERIALS', finish='FINISH')
    assert '{' not in out and '}' not in out          # no stray / unescaped braces
    assert 'necklace' in out
    low = tpl.lower()
    for bad in FORBIDDEN:
        assert bad not in low, f'accessory prompt {key} says "{bad}"'


def test_accessory_model_shots_carry_the_framing_and_step_3_has_no_model():
    for key in (1, 2, 11, 12):
        assert '{framing}' in server.NANO_BANANA_PROMPTS_ACCESSORY[key]
    for key in (3, 13):
        assert 'no model in frame' in server.NANO_BANANA_PROMPTS_ACCESSORY[key].lower()
    # Colour steps talk about the finish, not the fabric.
    for key in (5, 11, 12, 13, 14):
        low = server.NANO_BANANA_PROMPTS_ACCESSORY[key].lower()
        assert 'colourway' in low or 'finish' in low
    assert 'competitor colour references' in server.NANO_BANANA_PROMPTS_ACCESSORY[11]
    # Same opening as the other sets: the step-1 background photo is a dress editorial.
    assert server.NANO_BANANA_PROMPTS_ACCESSORY[1].startswith(
        "I've added a photo of a woman wearing a dress. I only want to use the background")


@pytest.mark.parametrize('name', ['NANO_BANANA_PROMPTS', 'NANO_BANANA_PROMPTS_SHOES', 'NANO_BANANA_PROMPTS_BAGS'])
def test_other_sets_still_format_with_product_type_and_color(name):
    for key in KEYS:
        out = getattr(server, name)[key].format(product_type='dress', color='red')
        assert '{' not in out and '}' not in out


@pytest.mark.parametrize('kind', KINDS)
def test_framing_exists_for_every_kind_and_names_the_product(kind):
    fr = server._nb_accessory_framing(kind)
    assert '{product_type}' in fr
    assert '{' not in fr.format(product_type='ring')


def test_framing_unknown_kind_falls_back_to_other():
    assert server._nb_accessory_framing('???') == server._nb_accessory_framing('other')


def test_render_prompt_accessory_uses_kind_specific_framing():
    p = server._nb_render_prompt(1, 'sunglasses', '')
    assert 'worn on her face' in p and 'sunglasses' in p
    assert '{' not in p and '}' not in p
    p = server._nb_render_prompt(2, 'watch', '')
    assert 'wrist raised' in p
    p = server._nb_render_prompt(11, 'bague', 'gold')
    assert 'competitor colour references' in p and 'bague' in p and "'gold'" in p
    assert 'shoulder' not in p                       # not the bag set any more
    for bad in FORBIDDEN:
        assert bad not in p.lower()


def test_render_prompt_other_sets_unchanged():
    assert server._nb_render_prompt(3, 'dress', '') == \
        server.NANO_BANANA_PROMPTS[3].format(product_type='dress', color='')
    assert server._nb_render_prompt(11, 'sneakers', 'black') == \
        server.NANO_BANANA_PROMPTS_SHOES[11].format(product_type='sneakers', color='black')
    assert server._nb_render_prompt(13, 'tote bag', 'tan') == \
        server.NANO_BANANA_PROMPTS_BAGS[13].format(product_type='tote bag', color='tan')


def test_lifestyle_prompt_accessory_branch():
    prompt, season = server._lifestyle_prompt('necklace', 'summer')
    assert season == 'summer'
    low = prompt.lower()
    assert 'garment' not in low
    assert 'our model wearing the necklace' in prompt
    assert 'Keep the EXACT same necklace — same shape, colour, materials and details —' in prompt
    assert 'chest up' in prompt                      # jewelry framing
    assert 'Do NOT change the accessory' in prompt
    # The other branches keep their wording.
    assert 'garment' in server._lifestyle_prompt('dress', 'summer')[0]
    assert 'carrying a tote bag' in server._lifestyle_prompt('tote bag', 'summer')[0]
    assert 'BOTH shoes' in server._lifestyle_prompt('sneakers', 'summer')[0]
