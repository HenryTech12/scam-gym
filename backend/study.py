"""Study endpoint logic: store a consented session and compute the summary."""
from __future__ import annotations

from collections import defaultdict

from . import db
from .config import LANGS
from .schemas import ItemRate, StudySession, StudySummary


def store_session(path: str, session: StudySession, known_drills: set[str]) -> None:
    drills = [d for d in dict.fromkeys(session.drills_played) if d in known_drills]
    db.insert_session(
        path,
        participant_id=str(session.participant_id),
        pre_set=session.pre_set,
        post_set=session.post_set,
        pre=[a.model_dump() for a in session.pre],
        post=[a.model_dump() for a in session.post],
        drills=drills,
        lang=session.lang,
    )


def _rate(answers: list[dict]) -> float:
    return sum(a["answer"] == "verify" for a in answers) / len(answers) if answers else 0.0


def summarize(all_sessions: list[dict], lang: str | None = None) -> StudySummary:
    """Rates for one language (or all combined when lang is None); by_lang always counts all."""
    by_lang = {code: sum(s.get("lang", "en") == code for s in all_sessions) for code in LANGS}
    sessions = [s for s in all_sessions if lang is None or s.get("lang", "en") == lang]
    if not sessions:
        return StudySummary(n=0, pre_verify_rate=0.0, post_verify_rate=0.0, change_points=0, per_item=[], by_lang=by_lang)
    pre = [a for s in sessions for a in s["pre"]]
    post = [a for s in sessions for a in s["post"]]
    pre_rate, post_rate = _rate(pre), _rate(post)

    by_item: dict[str, list[dict]] = defaultdict(list)
    for a in pre + post:
        by_item[a["item_id"]].append(a)
    per_item = [ItemRate(item_id=i, verify_rate=round(_rate(by_item[i]), 2)) for i in sorted(by_item)]

    return StudySummary(
        n=len(sessions),
        pre_verify_rate=round(pre_rate, 2),
        post_verify_rate=round(post_rate, 2),
        change_points=round((post_rate - pre_rate) * 100),
        per_item=per_item,
        by_lang=by_lang,
    )
