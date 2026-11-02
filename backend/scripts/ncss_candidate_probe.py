"""Collect a small, review-only sample from NCSS public job search.

Writes a new candidate file only. Never imports into the application catalogue.
"""
import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from urllib.parse import urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

BASE = "https://24365.ncss.cn"
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "text/html,application/json"}


class DetailParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.text = []
        self.links = []
        self.title_depth = False
        self.title = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "title":
            self.title_depth = True
        if tag == "div" and "mainContent" in attrs.get("class", "").split():
            self.depth = 1
        elif self.depth and tag == "div":
            self.depth += 1
        if self.depth:
            if tag in {"br", "p", "li", "tr"}:
                self.text.append("\n")
            if tag == "a" and attrs.get("href"):
                self.links.append(attrs["href"])

    def handle_endtag(self, tag):
        if tag == "title":
            self.title_depth = False
        if tag == "div" and self.depth:
            self.depth -= 1

    def handle_data(self, data):
        if self.depth:
            self.text.append(data)
        if self.title_depth:
            self.title.append(data)


def fetch(url):
    with urlopen(Request(url, headers=HEADERS), timeout=20) as response:
        body = response.read(1_000_001)
        if len(body) > 1_000_000:
            raise ValueError("response too large")
        return body.decode("utf-8", "replace")


def collect():
    query = urlencode({"offset": "1", "limit": "10", "jobName": "2027"})
    data = json.loads(fetch(BASE + "/student/jobs/jobslist/ajax/?" + query))
    if not data.get("flag") or not isinstance(data.get("data", {}).get("list"), list):
        raise ValueError("list denied or unexpected response; stop")
    candidates = []
    rejected = []
    for item in data["data"]["list"]:
        if len(candidates) == 3:
            break
        identifier = item.get("jobId", "")
        if not re.fullmatch(r"[A-Za-z0-9]+", identifier) or "2027" not in item.get("jobName", ""):
            continue
        url = f"{BASE}/student/jobs/{identifier}/detail.html"
        time.sleep(1)
        html = fetch(url)
        parser = DetailParser()
        parser.feed(html)
        title = "".join(parser.title).strip()
        if any(marker in title for marker in ("验证码", "访问限制", "登录", "安全验证")):
            raise ValueError("access restriction or login page; stop")
        if "信息已删除" in title:
            rejected.append({"source_url": url, "reason": "信息已删除"})
            continue
        description = re.sub(r"[ \t\r\f\v]+", " ", "".join(parser.text)).strip()
        if not description or "2027" not in (item.get("jobName", "") + description):
            rejected.append({"source_url": url, "reason": "正文缺失或届别不明"})
            continue
        raw_links = parser.links + re.findall(r'https?://[^\s<>"\']+', description)
        links = []
        for link in raw_links:
            link = urljoin(url, link.rstrip("。，；、)）"))
            if urlparse(link).scheme == "https" and link not in links:
                links.append(link)
        candidates.append({
            "source": "国家大学生就业服务平台", "source_url": url,
            "source_job_id": identifier, "title": item.get("jobName"),
            "company": item.get("recName"), "city_or_region": item.get("areaCodeName"),
            "education": item.get("degreeName"), "majors_list_field": item.get("major") or None,
            "graduation_year_evidence": item.get("jobName"), "description": description,
            "links_in_description": links, "application_url": None,
            "application_status": "unverified", "verification_note": "未核实投递入口及当前招聘状态；正文链接仅供复核。",
        })
    return {"source": BASE, "observed_at": datetime.now(timezone.utc).isoformat(),
            "query": "2027", "candidates": candidates, "rejected": rejected}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError("output exists; choose a new file")
    result = collect()
    if len(result["candidates"]) != 3:
        raise ValueError(f"only {len(result['candidates'])} eligible candidates; no file written")
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
        output.write("\n")
    print(f"saved {len(result['candidates'])} review-only candidates to {args.output}")


if __name__ == "__main__":
    main()
