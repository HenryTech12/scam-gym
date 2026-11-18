"""Validates frontend/data/scenarios.json against the rules in SPEC.md (Sections 6 and 16).

Run with: pytest backend/tests/test_scenarios.py
"""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCENARIOS_PATH = ROOT / "frontend" / "data" / "scenarios.json"
STUDY_PATH = ROOT / "frontend" / "data" / "study_items.json"

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
]


def load():
    with SCENARIOS_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


DATA = load()
SCENARIOS = DATA["scenarios"]
IDS = [s["id"] for s in SCENARIOS]


def test_top_level_shape():
    assert DATA["version"] == 1
    assert set(DATA["tactics_glossary"]) == TACTICS
    for tid, entry in DATA["tactics_glossary"].items():
        assert entry["name"] and entry["explanation"] and entry["safer"], tid
    assert len(SCENARIOS) >= 3
    assert len(set(IDS)) == len(IDS), "scenario ids must be unique"
    for required in ("bank-call", "family-voice", "pos-alert"):
        assert required in IDS


@pytest.mark.parametrize("scenario", SCENARIOS, ids=IDS)
def test_scenario_metadata(scenario):
    for key in ("id", "title", "blurb", "audience", "caller", "start", "nodes", "ends"):
        assert key in scenario, key
    assert scenario["caller"]["name"] and scenario["caller"]["role"]
    assert scenario["caller"]["voice"] in {"male", "female"}
    assert scenario["start"] in scenario["nodes"]
    assert not set(scenario["nodes"]) & set(scenario["ends"]), "node and end ids must not collide"


@pytest.mark.parametrize("scenario", SCENARIOS, ids=IDS)
def test_nodes_and_choices(scenario):
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


@pytest.mark.parametrize("scenario", SCENARIOS, ids=IDS)
def test_ends(scenario):
    ends = scenario["ends"]
    assert any(e["result"] == "safe" for e in ends.values())
    assert any(e["result"] == "lost" for e in ends.values())
    for eid, end in ends.items():
        assert end["result"] in {"safe", "lost"}, eid
        assert end["headline"].strip(), eid
        assert end["habit"].strip(), eid


@pytest.mark.parametrize("scenario", SCENARIOS, ids=IDS)
def test_reachable_acyclic_and_shallow(scenario):
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


@pytest.mark.parametrize("scenario", SCENARIOS, ids=IDS)
def test_every_node_has_a_safe_way_out(scenario):
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


def _all_text(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _all_text(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _all_text(v)


@pytest.mark.parametrize("path", [SCENARIOS_PATH, STUDY_PATH], ids=["scenarios", "study_items"])
def test_no_real_brand_names(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    text = "\n".join(_all_text(data))
    for name in BLOCKED_NAMES:
        pattern = r"(?<![A-Za-z])" + re.escape(name) + r"(?![A-Za-z])"
        assert not re.search(pattern, text, flags=re.IGNORECASE), f"real name found: {name}"


@pytest.mark.parametrize("path", [SCENARIOS_PATH, STUDY_PATH], ids=["scenarios", "study_items"])
def test_no_urls_phones_or_emails(path):
    text = "\n".join(_all_text(json.loads(path.read_text(encoding="utf-8"))))
    assert not re.search(r"https?://|www\.", text, flags=re.IGNORECASE)
    assert not re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text)
    assert not re.search(r"\+?\d[\d\s-]{9,}\d", text), "looks like a phone number"


def test_study_items():
    data = json.loads(STUDY_PATH.read_text(encoding="utf-8"))
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
