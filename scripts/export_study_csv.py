"""Export anonymous study results to CSV (one row per answer).

Usage: python scripts/export_study_csv.py [--db ./study.db] [--out study_export.csv]
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend import db  # noqa: E402
from backend.config import get_settings  # noqa: E402
from backend.study import summarize  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", default=get_settings().database_path)
    parser.add_argument("--out", default="study_export.csv")
    args = parser.parse_args()

    if not Path(args.db).exists():
        sys.exit(f"No database at {args.db}")
    sessions = db.all_sessions(args.db)
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["participant_id", "created_at", "phase", "set", "item_id", "answer", "drills_played"])
        for s in sessions:
            drills = ";".join(s["drills"])
            for phase, set_id in (("pre", s["pre_set"]), ("post", s["post_set"])):
                for a in s[phase]:
                    writer.writerow([s["participant_id"], s["created_at"], phase, set_id, a["item_id"], a["answer"], drills])

    summary = summarize(sessions)
    print(f"Wrote {args.out}: {summary.n} participants")
    print(f"Verify rate before: {summary.pre_verify_rate:.0%}, after: {summary.post_verify_rate:.0%}, "
          f"change: {summary.change_points:+d} points ({summary.label.lower()})")
    # A safer-outcome example for the write-up: comply before, verify after on matched scenarios.
    improved = sum(
        1 for s in sessions
        if sum(a["answer"] == "verify" for a in s["post"]) > sum(a["answer"] == "verify" for a in s["pre"])
    )
    print(f"Participants who chose verify more often after the drills: {improved}")


if __name__ == "__main__":
    main()
