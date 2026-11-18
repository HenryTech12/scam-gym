import asyncio

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app, load_scenarios
from backend.rephrase import Rephraser, numbers, proper_nouns, validate

BANK_N1 = load_scenarios()["scenarios"][0]["nodes"]["n1"]["say"]
BANK_N2 = load_scenarios()["scenarios"][0]["nodes"]["n2"]["say"]
ES_N2 = load_scenarios("es")["scenarios"][0]["nodes"]["n2"]["say"]
FR_N1 = load_scenarios("fr")["scenarios"][0]["nodes"]["n1"]["say"]
FR_N2 = load_scenarios("fr")["scenarios"][0]["nodes"]["n2"]["say"]

GOOD_ES_N2 = (
    "Gracias. Su saldo es de unos 180.000. Alguien ha intentado mover 250.000 hace un momento. "
    "Le acabamos de enviar un código. Léamelo para que bloquee la operación."
)
GOOD_FR_N2 = (
    "Merci. Votre solde est d'environ 180 000. Quelqu'un a tenté de transférer 250 000 à l'instant. "
    "On vient de vous envoyer un code. Lisez-le-moi pour que je bloque l'opération."
)

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

    async def gen(line, lang):
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

    async def gen(line, lang):
        calls.append(line)
        return f'"{GOOD_N2}"'

    r = make(gen)
    assert run(r.rephrase("bank-call", "n2", BANK_N2)) == (GOOD_N2, "llm")
    assert run(r.rephrase("bank-call", "n2", BANK_N2)) == (GOOD_N2, "llm")
    assert len(calls) == 1


def test_invalid_output_falls_back():
    async def gen(line, lang):
        return GOOD_N2.replace("₦250,000", "₦2,500,000")

    assert run(make(gen).rephrase("bank-call", "n2", BANK_N2)) == (BANK_N2, "fallback")


def test_error_falls_back():
    async def gen(line, lang):
        raise RuntimeError("provider down")

    assert run(make(gen).rephrase("bank-call", "n2", BANK_N2)) == (BANK_N2, "fallback")


def test_timeout_falls_back(monkeypatch):
    monkeypatch.setattr("backend.rephrase.TIMEOUT_SECONDS", 0.05)

    async def gen(line, lang):
        await asyncio.sleep(1)
        return GOOD_N2

    assert run(make(gen).rephrase("bank-call", "n2", BANK_N2)) == (BANK_N2, "fallback")


def test_endpoint_uses_server_copy(db_path):
    seen = []

    async def gen(line, lang):
        seen.append(line)
        return GOOD_N2

    app = create_app(Settings(llm_enabled=True, database_path=db_path), generator=gen)
    with TestClient(app) as c:
        assert c.get("/api/health").json()["llm_enabled"] is True
        res = c.post("/api/rephrase", json={"scenario_id": "bank-call", "node_id": "n2"})
        assert res.json() == {"say": GOOD_N2, "source": "llm"}
    assert seen == [BANK_N2]


def test_spanish_and_french_rephrases_pass():
    ok, why = validate(ES_N2, GOOD_ES_N2, "es", BANK_N2)
    assert ok, why
    ok, why = validate(FR_N2, GOOD_FR_N2, "fr", BANK_N2)
    assert ok, why


def test_names_are_kept_in_french():
    assert {"M", "Lefèvre", "Kestrel", "Bank"} <= proper_nouns(FR_N1)
    ok, why = validate(FR_N1, FR_N1.replace("Lefèvre", "Martin"), "fr")
    assert not ok and "names missing" in why
    # Accents are compared loosely: an unaccented spelling still counts as the same name.
    ok, why = validate(FR_N1, FR_N1.replace("Lefèvre", "Lefevre"), "fr")
    assert ok, why


@pytest.mark.parametrize(
    "lang, original, candidate, reason",
    [
        ("es", ES_N2, BANK_N2, "language check"),  # identical to the English line
        ("fr", FR_N2, "Thanks, your balance is 180 000 and the thief is moving 250 000. You must read the code and you will be safe.", "language check"),
        ("es", ES_N2, GOOD_ES_N2.replace("250.000", "25.000"), "numbers changed"),
        ("es", ES_N2, GOOD_ES_N2.replace("Léamelo", "Dígame su contraseña y léamelo"), "new request"),
        ("fr", FR_N2, GOOD_FR_N2.replace("Lisez-le-moi", "Donnez-moi votre mot de passe et lisez-le"), "new request"),
        ("fr", FR_N2, GOOD_FR_N2.replace("Merci.", "Merci, ici la Gendarmerie."), "new agency"),
        ("es", ES_N2, GOOD_ES_N2.replace("Gracias.", "Gracias, le llamo de Santander."), "blocked"),
        ("fr", FR_N2, GOOD_FR_N2 + " Rendez-vous sur www.kestrel-aide.fr", "URL"),
    ],
)
def test_language_validators_reject(lang, original, candidate, reason):
    ok, why = validate(original, candidate, lang, BANK_N2)
    assert not ok
    assert reason.split()[0] in why, why


def test_english_stop_word_limit_is_three():
    base = GOOD_FR_N2
    assert validate(FR_N2, base.replace("Merci.", "Merci, the end and you."), "fr", BANK_N2)[0]  # 3 words: allowed
    ok, why = validate(FR_N2, base.replace("Merci.", "Merci, the end and you is."), "fr", BANK_N2)
    assert not ok and "English" in why


def test_endpoint_lang_uses_that_language_file(db_path):
    seen = []

    async def gen(line, lang):
        seen.append((line, lang))
        return {"es": GOOD_ES_N2, "fr": GOOD_FR_N2}.get(lang, GOOD_N2)

    app = create_app(Settings(llm_enabled=True, database_path=db_path), generator=gen)
    with TestClient(app) as c:
        assert c.post("/api/rephrase", json={"scenario_id": "bank-call", "node_id": "n2", "lang": "es"}).json() == {"say": GOOD_ES_N2, "source": "llm"}
        assert c.post("/api/rephrase", json={"scenario_id": "bank-call", "node_id": "n2", "lang": "fr"}).json() == {"say": GOOD_FR_N2, "source": "llm"}
        assert c.post("/api/rephrase", json={"scenario_id": "bank-call", "node_id": "n2", "lang": "de"}).status_code == 422
    assert seen == [(ES_N2, "es"), (FR_N2, "fr")]


def test_non_english_fallback_returns_that_language(db_path):
    app = create_app(Settings(llm_enabled=False, database_path=db_path))
    with TestClient(app) as c:
        res = c.post("/api/rephrase", json={"scenario_id": "bank-call", "node_id": "n2", "lang": "fr"}).json()
    assert res == {"say": FR_N2, "source": "fallback"}
