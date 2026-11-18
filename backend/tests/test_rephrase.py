import asyncio

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app, load_scenarios
from backend.rephrase import Rephraser, numbers, proper_nouns, validate

BANK_N1 = load_scenarios()["scenarios"][0]["nodes"]["n1"]["say"]
BANK_N2 = load_scenarios()["scenarios"][0]["nodes"]["n2"]["say"]

GOOD_N2 = (
    "Thanks. Your balance shows about ₦180,000. Someone has just tried to move ₦250,000. "
    "We sent you a code a moment ago. Read it out so I can block it."
)


def test_good_rephrase_passes():
    ok, reason = validate(BANK_N2, GOOD_N2)
    assert ok, reason


def test_extractors():
    assert numbers(BANK_N2) == {"180000", "250000"}
    assert {"Mr", "Adebayo", "Kestrel", "Bank", "BVN"} <= proper_nouns(BANK_N1)


@pytest.mark.parametrize(
    "candidate, reason",
    [
        (GOOD_N2.replace("Read it out", "Visit www.kestrel-help.com and read it out"), "URL"),
        (GOOD_N2.replace("Read it out", "Go to https://example.org, read it out"), "URL"),
        (GOOD_N2.replace("Read it out", "Call 0803 123 4567 and read it out"), "phone number"),
        (GOOD_N2.replace("Read it out", "Text +2348031234567, read it out"), "phone number"),
        (GOOD_N2.replace("Read it out", "Email help@kestrel.ng and read it"), "email"),
        (GOOD_N2.replace("₦250,000", "₦25,000"), "numbers changed"),
        (GOOD_N2.replace("₦180,000", "₦190,000"), "numbers changed"),
        (GOOD_N2.replace("so I can block it", "and your PIN so I can block it"), "new request"),
        (GOOD_N2.replace("Thanks.", "Thanks, this is GTBank."), "blocked term"),
        (GOOD_N2.replace("Thanks.", "Thanks, EFCC here."), "new agency"),
        (GOOD_N2 + " " + GOOD_N2, "length"),
        ("Read me the code.", "length"),
        ("", "empty"),
    ],
)
def test_validator_rejects(candidate, reason):
    ok, why = validate(BANK_N2, candidate)
    assert not ok
    assert reason.split()[0] in why


def test_validator_requires_names():
    changed = BANK_N1.replace("Kestrel", "Falcon")
    ok, why = validate(BANK_N1, changed)
    assert not ok and "names missing" in why


def run(coro):
    return asyncio.run(coro)


def make(generator, enabled=True):
    return Rephraser(Settings(llm_enabled=enabled), generator)


def test_disabled_never_calls_generator():
    called = []

    async def gen(line):
        called.append(line)
        return line

    assert run(make(gen, enabled=False).rephrase("bank-call", "n2", BANK_N2)) == (BANK_N2, "fallback")
    assert called == []


def test_disabled_without_key_by_default():
    r = Rephraser(Settings(llm_enabled=True, llm_provider="anthropic", llm_api_key=""))
    assert not r.enabled
    assert run(r.rephrase("bank-call", "n2", BANK_N2)) == (BANK_N2, "fallback")


def test_valid_output_is_used_and_cached():
    calls = []

    async def gen(line):
        calls.append(line)
        return f'"{GOOD_N2}"'

    r = make(gen)
    assert run(r.rephrase("bank-call", "n2", BANK_N2)) == (GOOD_N2, "llm")
    assert run(r.rephrase("bank-call", "n2", BANK_N2)) == (GOOD_N2, "llm")
    assert len(calls) == 1


def test_invalid_output_falls_back():
    async def gen(line):
        return GOOD_N2.replace("₦250,000", "₦2,500,000")

    assert run(make(gen).rephrase("bank-call", "n2", BANK_N2)) == (BANK_N2, "fallback")


def test_error_falls_back():
    async def gen(line):
        raise RuntimeError("provider down")

    assert run(make(gen).rephrase("bank-call", "n2", BANK_N2)) == (BANK_N2, "fallback")


def test_timeout_falls_back(monkeypatch):
    monkeypatch.setattr("backend.rephrase.TIMEOUT_SECONDS", 0.05)

    async def gen(line):
        await asyncio.sleep(1)
        return GOOD_N2

    assert run(make(gen).rephrase("bank-call", "n2", BANK_N2)) == (BANK_N2, "fallback")


def test_endpoint_uses_server_copy(db_path):
    seen = []

    async def gen(line):
        seen.append(line)
        return GOOD_N2

    app = create_app(Settings(llm_enabled=True, database_path=db_path), generator=gen)
    with TestClient(app) as c:
        assert c.get("/api/health").json()["llm_enabled"] is True
        res = c.post("/api/rephrase", json={"scenario_id": "bank-call", "node_id": "n2"})
        assert res.json() == {"say": GOOD_N2, "source": "llm"}
    assert seen == [BANK_N2]
