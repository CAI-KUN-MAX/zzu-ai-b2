"""Read-only audit of a user-supplied BOSS export; never emit personal/access fields.

Usage: python backend/scripts/audit_boss_jobs.py SOURCE_DIRECTORY --output REPORT.json
No raw records, recruiter fields or access identifiers are copied to the output.
"""
import argparse
from collections import Counter
import json
from pathlib import Path


def audit(directory):
    totals = Counter()
    cities = {}
    degrees = Counter()
    experience = Counter()
    identifiers = set()
    fresh_with_jd_ids = set()
    fresh_postgraduate_with_jd_ids = set()
    for path in sorted(Path(directory).glob("jobs_*.json")):
        rows = json.loads(path.read_text(encoding="utf-8-sig"))
        if not isinstance(rows, list):
            raise ValueError(f"Expected a list: {path.name}")
        cities[path.stem.removeprefix("jobs_")] = len(rows)
        for row in rows:
            totals["records"] += 1
            identifier = row.get("encryptJobId")
            if identifier:
                identifiers.add(identifier)
            degrees[row.get("jobDegree", "未标注")] += 1
            experience[row.get("jobExperience", "未标注")] += 1
            description = row.get("jobDescription")
            has_jd = isinstance(description, str) and bool(description.strip())
            fresh = row.get("jobExperience") in {"在校/应届", "应届生"}
            graduate = row.get("jobDegree") in {"硕士", "博士"}
            if identifier and fresh and has_jd:
                fresh_with_jd_ids.add(identifier)
                if graduate:
                    fresh_postgraduate_with_jd_ids.add(identifier)
            totals["with_jd"] += has_jd
            totals["fresh_graduate"] += fresh
            totals["fresh_graduate_with_jd"] += fresh and has_jd
            totals["postgraduate_with_jd"] += graduate and has_jd
            totals["fresh_postgraduate_with_jd"] += fresh and graduate and has_jd
            # Deliberately inspect presence, not values, of date metadata.
            totals["with_publication_field"] += any(row.get(key) for key in (
                "published_at", "publishTime", "publishDate", "releaseDate", "发布时间"))
    return dict(source="用户提供的 BOSS直聘数据（泛信管类岗位）", audit_date="2026-10-26",
                totals=dict(totals), unique_job_ids=len(identifiers),
                unique_fresh_graduate_with_jd=len(fresh_with_jd_ids),
                unique_fresh_postgraduate_with_jd=len(fresh_postgraduate_with_jd_ids), by_city=cities,
                by_degree=dict(degrees), by_experience=dict(experience),
                usable_as="待补核线索；补齐来源发布日期和当前投递状态后才能进入正式岗位集",
                formal_catalogue_imported=0,
                limitations=["没有岗位发布日期字段，文件时间、头像日期、采集时间不能替代发布日期",
                             "jobValidStatus/bossOnline 是采集时状态，不能证明目前可投",
                             "泛信管类样本不能替代十个专业大类的覆盖",
                             "统计为记录条数，可能跨城市重复；unique_job_ids 单独按岗位ID去重"],
                excluded_fields="招聘者姓名、头像、个人标识、securityId、位置坐标及所有原始岗位文本不输出")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = audit(args.source)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["totals"], ensure_ascii=False))


if __name__ == "__main__":
    main()
