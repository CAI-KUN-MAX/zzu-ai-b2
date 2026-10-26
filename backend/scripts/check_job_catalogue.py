"""Check catalogue structure, then explicitly report the 40-job acceptance gap.

Run from the repository root. --require-target returns 1 for unmet coverage;
default exits successfully on valid data while reporting target_met=false.
"""
import argparse
from collections import Counter
from datetime import date
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.job_schemas import Job

CATEGORIES = ["计算机", "电子机械", "土木建筑", "化工材料", "生物医药", "经管财会",
              "文法教育", "外语传播", "艺术设计", "农林环境"]


def check(path, as_of):
    data = json.loads(path.read_text(encoding="utf-8"))
    jobs = [Job.model_validate(row) for row in data["items"]]
    ids = [j.job_id for j in jobs]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate job_id")
    for job in jobs:
        if job.published_at > as_of or job.verified_at.date() > as_of:
            raise ValueError("future catalogue date: " + job.job_id)
    active = [j for j in jobs if j.application_status == "open"]
    counts = Counter(j.category for j in active)
    graduates = sum(j.education in {"硕士", "博士"} for j in active)
    undergraduates = sum(j.education == "本科" for j in active)
    gaps = {category: max(0, 4 - counts[category]) for category in CATEGORIES}
    return dict(version=data["version"], structural_validation="passed", records=len(jobs),
                open=len(active), unverified=sum(j.application_status == "unverified" for j in jobs),
                open_by_category={c: counts[c] for c in CATEGORIES},
                open_postgraduate=graduates, open_undergraduate=undergraduates,
                missing_total=max(0, 40 - len(active)), missing_by_category=gaps,
                missing_postgraduate=max(0, 12 - graduates), missing_undergraduate=max(0, 20 - undergraduates),
                target_met=len(active) >= 40 and not any(gaps.values()) and graduates >= 12 and undergraduates >= 20)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalogue", type=Path,
                        default=Path(__file__).resolve().parents[1] / "catalogue" / "jobs.v1.json")
    parser.add_argument("--as-of", type=date.fromisoformat, required=True)
    parser.add_argument("--require-target", action="store_true")
    args = parser.parse_args()
    result = check(args.catalogue, args.as_of)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.require_target and not result["target_met"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
