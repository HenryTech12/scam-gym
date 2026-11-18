"""Validates frontend/data/scenarios.<lang>.json and study_items.<lang>.json against SPEC.md
(Sections 6 and 16) and Addendum A (parity across languages, keyword coverage).

Run with: pytest backend/tests/test_scenarios.py
"""
import itertools
import json
import re
import unicodedata
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "frontend" / "data"
LANGS = ["en", "es", "fr"]
SCENARIO_PATHS = {lang: DATA_DIR / f"scenarios.{lang}.json" for lang in LANGS}
STUDY_PATHS = {lang: DATA_DIR / f"study_items.{lang}.json" for lang in LANGS}
MIN_KEYWORDS = 8
MAX_SAY_WORDS = 45

TACTICS = {
    "authority", "deadline", "fear", "fake_proof", "secrecy",
    "isolation", "emotion", "rush", "fake_alert",
}
CHOICE_TYPES = {"safe", "risky", "stall"}
MAX_DEPTH = 5

# Real banks, fintechs, telecoms, card schemes, apps and agencies that must never
# appear in a drill. The EFCC is allowed only in the "if this happened for real"
# guidance in the UI, never in scenario text.
BLOCKED_NAMES = [
    "Access Bank", "Zenith", "GTBank", "GTCO", "Guaranty Trust", "First Bank", "FirstBank",
    "UBA", "United Bank for Africa", "Fidelity", "Union Bank", "Stanbic", "Sterling",
    "Wema", "Ecobank", "FCMB", "Polaris", "Keystone", "Heritage Bank", "Unity Bank",
    "Jaiz", "Providus", "Globus", "Titan Trust", "Opay", "Moniepoint", "Palmpay",
    "Kuda", "Carbon", "FairMoney", "Paga", "Paystack", "Flutterwave", "Interswitch",
    "Quickteller", "Remita", "Visa", "Mastercard", "Verve", "MTN", "Glo", "Globacom",
    "Airtel", "9mobile", "Etisalat", "WhatsApp", "Facebook", "Instagram", "Telegram",
    "Google", "Apple", "CBN", "Central Bank", "NIBSS", "EFCC", "ICPC", "DSS", "NDLEA",
    "Nigeria Police", "NCC", "FIRS", "Interpol", "FBI", "DHL", "Jumia", "Konga",
    # Spanish- and French-speaking banks, telecoms and agencies.
    # ("Claro" is left out: it is also everyday Spanish for "of course".)
    "Santander", "BBVA", "CaixaBank", "Bancolombia", "Banorte", "Movistar", "Telcel",
    "Guardia Civil", "Policía Nacional", "BNP", "Société Générale", "Crédit Agricole", "Orange",
    "SFR", "Gendarmerie", "DGCCRF", "Pharos",
]
# Nigeria-specific details stay in the English file only (Addendum A, Section 4).
NIGERIA_ONLY = ["₦", "BVN", "naira", "abeg", "oga", "POS"]


def load(lang):
    with SCENARIO_PATHS[lang].open(encoding="utf-8") as fh:
        return json.load(fh)


ALL = {lang: load(lang) for lang in LANGS}
CASES = [(lang, s) for lang in LANGS for s in ALL[lang]["scenarios"]]
CASE_IDS = [f"{lang}-{s['id']}" for lang, s in CASES]


def fold(text, lang):
    """Mirror of matcher.js normalization (without stop words) for duplicate checks."""
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = re.sub(r"[’'`]", "" if lang == "en" else " ", text)
    text = re.sub(r"[^\w\s]|_", " ", text)
    return " ".join(text.split())


@pytest.mark.parametrize("lang", LANGS)
def test_top_level_shape(lang):
    data = ALL[lang]
    ids = [s["id"] for s in data["scenarios"]]
    assert data["version"] == 1
    assert set(data["tactics_glossary"]) == TACTICS
    for tid, entry in data["tactics_glossary"].items():
        assert entry["name"] and entry["explanation"] and entry["safer"], tid
    assert len(ids) >= 3
    assert len(set(ids)) == len(ids), "scenario ids must be unique"
    for required in ("bank-call", "family-voice", "pos-alert"):
        assert required in ids


def structure(data):
    """Everything that must be identical across languages."""
    return [
        {
            "id": s["id"],
            "start": s["start"],
            "voice": s["caller"]["voice"],
            "flags": sorted(k for k in s if k in ("notice", "offer_family_code")),
            "nodes": {
                nid: {
                    "tactics": n["tactics"],
                    "visual": "visual" in n,
                    "choices": [(c["id"], c["type"], c["to"]) for c in n["choices"]],
                }
                for nid, n in s["nodes"].items()
            },
            "ends": {eid: e["result"] for eid, e in s["ends"].items()},
        }
        for s in data["scenarios"]
    ]


@pytest.mark.parametrize("a, b", list(itertools.combinations(LANGS, 2)))
def test_parity_across_languages(a, b):
    assert structure(ALL[a]) == structure(ALL[b])
    assert set(ALL[a]["tactics_glossary"]) == set(ALL[b]["tactics_glossary"])


@pytest.mark.parametrize("lang, scenario", CASES, ids=CASE_IDS)
def test_keyword_coverage(lang, scenario):
    for nid, node in scenario["nodes"].items():
        owner = {}
        for c in node["choices"]:
            folded = {fold(k, lang) for k in c["keywords"]}
            assert len(folded) >= MIN_KEYWORDS, f"{lang}/{scenario['id']}/{nid}/{c['id']}: {len(folded)} keywords"
            for k in folded:
                assert k not in owner, f"{lang}/{scenario['id']}/{nid}: '{k}' in {owner.get(k)} and {c['id']}"
                owner[k] = c["id"]


@pytest.mark.parametrize("lang, scenario", CASES, ids=CASE_IDS)
def test_lines_stay_short(lang, scenario):
    for nid, node in scenario["nodes"].items():
        assert len(node["say"].split()) <= MAX_SAY_WORDS, f"{lang}/{scenario['id']}/{nid} is too long"


@pytest.mark.parametrize("lang", ["es", "fr"])
def test_nigeria_specific_details_only_in_english(lang):
    text = "\n".join(_all_text(ALL[lang], skip_ids=True))
    for term in NIGERIA_ONLY:
        assert not re.search(r"(?<![\w])" + re.escape(term) + r"(?![\w])", text, flags=re.IGNORECASE), term
    assert "Kestrel Bank" in text


@pytest.mark.parametrize("lang, scenario", CASES, ids=CASE_IDS)
def test_scenario_metadata(lang, scenario):
    for key in ("id", "title", "blurb", "audience", "caller", "start", "nodes", "ends"):
        assert key in scenario, key
    assert scenario["caller"]["name"] and scenario["caller"]["role"]
    assert scenario["caller"]["voice"] in {"male", "female"}
    assert scenario["start"] in scenario["nodes"]
    assert not set(scenario["nodes"]) & set(scenario["ends"]), "node and end ids must not collide"


@pytest.mark.parametrize("lang, scenario", CASES, ids=CASE_IDS)
def test_nodes_and_choices(lang, scenario):
    nodes, ends = scenario["nodes"], scenario["ends"]
    for nid, node in nodes.items():
        assert node["say"].strip(), nid
        assert node["tactics"], f"{nid} has no tactics"
        for t in node["tactics"]:
            assert t in TACTICS, f"{nid}: unknown tactic {t}"
        assert len(set(node["tactics"])) == len(node["tactics"])
        choices = node["choices"]
        assert 2 <= len(choices) <= 4, f"{nid} must have 2 to 4 choices"
        assert any(c["type"] == "safe" for c in choices), f"{nid} has no safe choice"
        assert len({c["id"] for c in choices}) == len(choices)
        for c in choices:
            where = f"{scenario['id']}/{nid}/{c['id']}"
            assert c["type"] in CHOICE_TYPES, where
            assert c["label"].strip(), where
            assert c["to"] in nodes or c["to"] in ends, f"{where}: target {c['to']} missing"
            assert c["keywords"], where
            for kw in c["keywords"]:
                assert kw == kw.lower().strip(), f"{where}: keyword {kw!r} must be lowercase"
            if c["type"] == "stall":
                assert c["to"] in nodes, f"{where}: stall must not point to an end"
                assert len(nodes[c["to"]]["tactics"]) > len(node["tactics"]), (
                    f"{where}: stall must lead to higher pressure (more tactics)"
                )
            if c["type"] == "safe" and c["to"] in ends:
                assert ends[c["to"]]["result"] == "safe", f"{where}: safe must end safe"
            if c["type"] == "risky" and c["to"] in ends:
                assert ends[c["to"]]["result"] == "lost", f"{where}: risky must end lost"


@pytest.mark.parametrize("lang, scenario", CASES, ids=CASE_IDS)
def test_ends(lang, scenario):
    ends = scenario["ends"]
    assert any(e["result"] == "safe" for e in ends.values())
    assert any(e["result"] == "lost" for e in ends.values())
    for eid, end in ends.items():
        assert end["result"] in {"safe", "lost"}, eid
        assert end["headline"].strip(), eid
        assert end["habit"].strip(), eid


@pytest.mark.parametrize("lang, scenario", CASES, ids=CASE_IDS)
def test_reachable_acyclic_and_shallow(lang, scenario):
    nodes, ends = scenario["nodes"], scenario["ends"]
    seen_nodes, seen_ends = set(), set()

    def walk(nid, stack, depth):
        assert nid not in stack, f"cycle through {nid}"
        assert depth <= MAX_DEPTH, f"path deeper than {MAX_DEPTH} nodes at {nid}"
        seen_nodes.add(nid)
        for c in nodes[nid]["choices"]:
            if c["to"] in ends:
                seen_ends.add(c["to"])
            else:
                walk(c["to"], stack | {nid}, depth + 1)

    walk(scenario["start"], frozenset(), 1)
    assert seen_nodes == set(nodes), f"unreachable nodes: {set(nodes) - seen_nodes}"
    assert seen_ends == set(ends), f"unreachable ends: {set(ends) - seen_ends}"


@pytest.mark.parametrize("lang, scenario", CASES, ids=CASE_IDS)
def test_every_node_has_a_safe_way_out(lang, scenario):
    """A safe choice that points to a node (the family code word) must still lead to a safe end."""
    nodes, ends = scenario["nodes"], scenario["ends"]

    def can_end_safe(nid):
        for c in nodes[nid]["choices"]:
            if c["type"] != "safe":
                continue
            if c["to"] in ends:
                if ends[c["to"]]["result"] == "safe":
                    return True
            elif can_end_safe(c["to"]):
                return True
        return False

    for nid in nodes:
        assert can_end_safe(nid), f"{nid}: safe choices never reach a safe end"


ID_FIELDS = {"id", "to", "start", "type", "tactics", "voice", "result", "audience", "kind"}


def _all_text(obj, skip_ids=False):
    """All strings; with skip_ids, only human-readable fields (not ids like "pos-alert")."""
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if skip_ids and k in ID_FIELDS:
                continue
            yield from _all_text(v, skip_ids)
    elif isinstance(obj, list):
        for v in obj:
            yield from _all_text(v, skip_ids)


ALL_PATHS = list(SCENARIO_PATHS.values()) + list(STUDY_PATHS.values())


@pytest.mark.parametrize("path", ALL_PATHS, ids=[p.stem for p in ALL_PATHS])
def test_no_real_brand_names(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    text = "\n".join(_all_text(data))
    for name in BLOCKED_NAMES:
        pattern = r"(?<![A-Za-z])" + re.escape(name) + r"(?![A-Za-z])"
        assert not re.search(pattern, text, flags=re.IGNORECASE), f"real name found: {name}"


@pytest.mark.parametrize("path", ALL_PATHS, ids=[p.stem for p in ALL_PATHS])
def test_no_urls_phones_or_emails(path):
    text = "\n".join(_all_text(json.loads(path.read_text(encoding="utf-8"))))
    assert not re.search(r"https?://|www\.", text, flags=re.IGNORECASE)
    assert not re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text)
    assert not re.search(r"\+?\d[\d\s-]{9,}\d", text), "looks like a phone number"


@pytest.mark.parametrize("lang", LANGS)
def test_study_items(lang):
    data = json.loads(STUDY_PATHS[lang].read_text(encoding="utf-8"))
    assert data["correct"] == "verify"
    items = data["items"]
    for set_id in ("A", "B"):
        subset = [i for i in items if i["set"] == set_id]
        assert len(subset) == 5, set_id
        assert [i["id"] for i in subset] == [f"{set_id}{n}" for n in range(1, 6)]
        for item in subset:
            assert item["text"].strip()
            assert sorted(o["id"] for o in item["options"]) == ["comply", "verify"]
            assert all(o["label"].strip() for o in item["options"])


@pytest.mark.parametrize("lang", ["es", "fr"])
def test_study_items_parity(lang):
    en = json.loads(STUDY_PATHS["en"].read_text(encoding="utf-8"))
    other = json.loads(STUDY_PATHS[lang].read_text(encoding="utf-8"))
    shape = lambda d: [(i["id"], i["set"], [o["id"] for o in i["options"]]) for i in d["items"]]
    assert shape(en) == shape(other)
    assert other["correct"] == en["correct"]
    for a, b in zip(en["items"], other["items"]):
        assert a["text"] != b["text"], f"{lang}/{a['id']} is not translated"
