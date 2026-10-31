"""Read-only catalogue URL reachability audit; never submits applications."""
import argparse
import concurrent.futures
import json
from pathlib import Path

import httpx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    catalogue = json.loads((Path(__file__).resolve().parents[1] / "catalogue/jobs.v1.json").read_text())
    jobs = [job for job in catalogue["items"] if job["application_status"] == "open"]
    urls = sorted({job[key] for job in jobs for key in ("source_url", "application_url") if job.get(key)})
    def check(url):
        try:
            response = httpx.get(url, follow_redirects=True, timeout=15)
            return url, {"status": response.status_code, "final_url": str(response.url),
                         "classification": "reachable" if response.status_code == 200 else "needs_manual_review"}
        except httpx.HTTPError as error:
            return url, {"error": type(error).__name__, "classification": "needs_manual_review"}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = dict(pool.map(check, urls))
    report = {"limitations": "HTTP 200 only confirms reachability, not correct job content or successful application. Anti-bot and network failures are not proof of job closure.",
              "jobs": [{"job_id": job["job_id"], "title": job["title"], "company": job["company"],
                        **{key: {"url": job[key], **results[job[key]]} for key in ("source_url", "application_url")}}
                       for job in jobs], "unique_urls": len(urls), "results": results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({"jobs": len(jobs), "unique_urls": len(urls),
                      "reachable": sum(row["classification"] == "reachable" for row in results.values()),
                      "needs_manual_review": sum(row["classification"] != "reachable" for row in results.values())}))


if __name__ == "__main__":
    main()
