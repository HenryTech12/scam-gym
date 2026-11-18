"""UI string packs: every English key exists in every language, nothing is empty,
placeholders match, and no HTML is used (strings are inserted with textContent)."""
import json
import re
from pathlib import Path

import pytest

I18N = Path(__file__).resolve().parents[2] / "frontend" / "i18n"
LANGS = ["en", "es", "fr"]
PACKS = {lang: json.loads((I18N / f"{lang}.json").read_text(encoding="utf-8")) for lang in LANGS}
PLACEHOLDER = re.compile(r"\{(\w+)\}")


@pytest.mark.parametrize("lang", LANGS)
def test_no_empty_values_or_html(lang):
    for key, value in PACKS[lang].items():
        assert isinstance(value, str) and value.strip(), f"{lang}:{key} is empty"
        assert not re.search(r"<[a-z/!]", value, re.I), f"{lang}:{key} contains HTML"


@pytest.mark.parametrize("lang", ["es", "fr"])
def test_complete_and_placeholders_match(lang):
    en, other = PACKS["en"], PACKS[lang]
    missing = sorted(set(en) - set(other))
    assert not missing, f"{lang} missing keys: {missing}"
    assert not sorted(set(other) - set(en)), f"{lang} has unknown keys"
    for key in en:
        assert set(PLACEHOLDER.findall(en[key])) == set(PLACEHOLDER.findall(other[key])), f"{lang}:{key} placeholders differ"


@pytest.mark.parametrize("lang", ["es", "fr"])
def test_translated(lang):
    same = [k for k in PACKS["en"] if PACKS["en"][k] == PACKS[lang][k] and len(PACKS["en"][k]) > 12]
    assert not same, f"{lang} strings left in English: {same}"


def test_every_key_used_in_code_exists():
    js = "\n".join(p.read_text(encoding="utf-8") for p in (I18N.parent / "js").glob("*.js"))
    used = set(re.findall(r"""\bt\(\s*["']([\w.]+)["']""", js))
    used |= set(re.findall(r"""["']((?:real|about)\.\w+)["']""", js))
    missing = sorted(k for k in used if k not in PACKS["en"])
    assert not missing, f"keys used in code but missing from en.json: {missing}"
