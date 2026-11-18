import json
import uuid

import pytest
from fastapi.testclient import TestClient

from backend import db
from backend.config import SCENARIOS_PATH, Settings
from backend.main import create_app


def session_body(pre_answers=None, post_answers=None, **overrides):
    pre_answers = pre_answers or ["comply"] * 5
    post_answers = post_answers or ["verify"] * 5
    body = {
        "participant_id": str(uuid.uuid4()),
        "pre_set": "A",
        "post_set": "B",
        "pre": [{"item_id": f"A{i + 1}", "answer": a} for i, a in enumerate(pre_answers)],
        "post": [{"item_id": f"B{i + 1}", "answer": a} for i, a in enumerate(post_answers)],
        "drills_played": ["bank-call", "pos-alert"],
        "consent": True,
    }
    body.update(overrides)
    return body


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "llm_enabled": False}


def test_security_headers(client):
    for path in ("/api/health", "/", "/js/app.js"):
        res = client.get(path)
        assert res.headers["Content-Security-Policy"].startswith("default-src 'self'")
        assert "script-src 'self'" in res.headers["Content-Security-Policy"]
        assert res.headers["X-Content-Type-Options"] == "nosniff"
        assert res.headers["Referrer-Policy"] == "no-referrer"
        assert "set-cookie" not in res.headers
        assert "access-control-allow-origin" not in res.headers


def test_scenarios_match_bundled_file(client):
    res = client.get("/api/scenarios")
    assert res.status_code == 200
    assert res.json() == json.loads(SCENARIOS_PATH.read_text(encoding="utf-8"))


def test_static_and_spa_fallback(client):
    assert "Scam Gym" in client.get("/").text
    assert client.get("/data/scenarios.json").status_code == 200
    res = client.get("/some/unknown/page")
    assert res.status_code == 200 and "<main id=\"app\"" in res.text
    assert '<base href="/">' in res.text  # relative assets resolve from nested paths
    assert client.get("/api/nope").status_code == 404


def test_rephrase_disabled_returns_fallback(client):
    res = client.post("/api/rephrase", json={"scenario_id": "bank-call", "node_id": "n1"})
    assert res.status_code == 200
    data = res.json()
    assert data["source"] == "fallback"
    assert data["say"].startswith("Good afternoon. This is Mr. Adebayo")


def test_rephrase_rejects_client_text_and_unknown_nodes(client):
    assert client.post("/api/rephrase", json={"scenario_id": "bank-call", "node_id": "n1", "say": "x"}).status_code == 422
    assert client.post("/api/rephrase", json={"scenario_id": "bank-call", "node_id": "n9"}).status_code == 404
    assert client.post("/api/rephrase", json={"scenario_id": "../etc", "node_id": "n1"}).status_code == 422


def test_study_session_stored(client, db_path):
    res = client.post("/api/study/session", json=session_body())
    assert res.status_code == 201
    assert res.json() == {"stored": True}
    rows = db.all_sessions(db_path)
    assert len(rows) == 1
    assert rows[0]["drills"] == ["bank-call", "pos-alert"]


def test_study_duplicate_participant_ignored(client, db_path):
    body = session_body()
    assert client.post("/api/study/session", json=body).status_code == 201
    body["pre"][0]["answer"] = "verify"
    assert client.post("/api/study/session", json=body).status_code == 201
    rows = db.all_sessions(db_path)
    assert len(rows) == 1 and rows[0]["pre"][0]["answer"] == "comply"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b.update(consent=False),
        lambda b: b.pop("consent"),
        lambda b: b.update(pre=b["pre"][:4]),
        lambda b: b.update(post=b["post"] + [{"item_id": "B1", "answer": "verify"}]),
        lambda b: b.update(notes="my name is Ada and my number is 0803..."),
        lambda b: b["pre"][0].update(comment="free text"),
        lambda b: b["pre"][0].update(answer="maybe"),
        lambda b: b.update(participant_id="not-a-uuid"),
        lambda b: b.update(participant_id=str(uuid.uuid1())),
        lambda b: b.update(post_set="A"),
        lambda b: b["pre"][1].update(item_id="A1"),
        lambda b: b["pre"][0].update(item_id="B1"),
        lambda b: b.update(drills_played=["<script>"]),
    ],
)
def test_study_validation_rejects(client, db_path, mutate):
    body = session_body()
    mutate(body)
    res = client.post("/api/study/session", json=body)
    assert res.status_code == 422
    # Submitted values are never echoed back.
    assert "Ada" not in res.text and "free text" not in res.text
    assert db.all_sessions(db_path) == []


def test_summary_empty(client):
    res = client.get("/api/study/summary")
    assert res.json() == {
        "n": 0, "pre_verify_rate": 0.0, "post_verify_rate": 0.0,
        "change_points": 0, "per_item": [], "label": "Small sample, self-reported",
    }


def test_summary_math_on_seeded_db(client, db_path):
    # Participant 1: pre 1/5 verify, post 5/5. Participant 2: pre 3/5, post 4/5 (sets reversed).
    db.insert_session(db_path, participant_id=str(uuid.uuid4()), pre_set="A", post_set="B",
                      pre=[{"item_id": f"A{i}", "answer": a} for i, a in zip(range(1, 6), ["verify", "comply", "comply", "comply", "comply"])],
                      post=[{"item_id": f"B{i}", "answer": "verify"} for i in range(1, 6)], drills=["bank-call"])
    db.insert_session(db_path, participant_id=str(uuid.uuid4()), pre_set="B", post_set="A",
                      pre=[{"item_id": f"B{i}", "answer": a} for i, a in zip(range(1, 6), ["verify", "verify", "verify", "comply", "comply"])],
                      post=[{"item_id": f"A{i}", "answer": a} for i, a in zip(range(1, 6), ["verify", "verify", "verify", "verify", "comply"])], drills=[])
    data = client.get("/api/study/summary").json()
    assert data["n"] == 2
    assert data["pre_verify_rate"] == 0.4   # 4 of 10
    assert data["post_verify_rate"] == 0.9  # 9 of 10
    assert data["change_points"] == 50
    assert data["label"] == "Small sample, self-reported"
    rates = {r["item_id"]: r["verify_rate"] for r in data["per_item"]}
    assert len(rates) == 10
    assert rates["A1"] == 1.0   # verify, verify
    assert rates["A5"] == 0.0   # comply, comply
    assert rates["B4"] == 0.5   # verify (post), comply (pre)


def test_unknown_drills_are_dropped(client, db_path):
    client.post("/api/study/session", json=session_body(drills_played=["bank-call", "made-up", "bank-call"]))
    assert db.all_sessions(db_path)[0]["drills"] == ["bank-call"]


def test_rate_limit_on_write_endpoints(db_path):
    app = create_app(Settings(database_path=db_path))
    with TestClient(app) as c:
        codes = [c.post("/api/rephrase", json={"scenario_id": "bank-call", "node_id": "n1"}).status_code for _ in range(31)]
        assert codes[:30] == [200] * 30
        assert codes[30] == 429
        assert c.get("/api/health").status_code == 200  # reads are not limited
