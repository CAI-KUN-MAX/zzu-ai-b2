"""Read-only inspection of public recruitment pages; never submits forms.

Only the exact host of an explicitly supplied HTTPS URL is permitted, including
redirects. Output omits URL query strings, fragments and page body text.
"""
import argparse
from html.parser import HTMLParser
import json
import re
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener


def safe_url(url):
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        return None
    return urlunsplit(("https", parts.netloc, parts.path, "", ""))


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.title = []
        self.text = []
        self.controls = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        # Ignore input elements before inspecting any of their attributes.
        if tag == "input":
            return
        attrs = dict(attrs)
        parent_hidden = self.stack[-1][1] if self.stack else False
        style = re.sub(r"\s+", "", attrs.get("style", "").lower())
        hidden = (parent_hidden or tag in {"script", "style", "noscript", "template", "input"}
                  or "hidden" in attrs or attrs.get("aria-hidden", "").lower() == "true"
                  or "display:none" in style or "visibility:hidden" in style
                  or "hide" in attrs.get("class", "").split())
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}:
            self.stack.append((tag, hidden))
        if not hidden and tag in {"a", "button"}:
            self.current = {"tag": tag, "href": attrs.get("href"), "text": []}

    def handle_endtag(self, tag):
        if self.current and tag == self.current["tag"]:
            self.current["text"] = " ".join(" ".join(self.current["text"]).split())
            self.controls.append(self.current)
            self.current = None
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if any(tag == "title" for tag, _ in self.stack):
            self.title.append(data)
            return
        if not self.stack or self.stack[-1][1] or any(tag == "head" for tag, _ in self.stack):
            return
        self.text.append(data)
        if self.current:
            self.current["text"].append(data)


class RestrictedRedirect(HTTPRedirectHandler):
    def __init__(self, host):
        self.host = host
        self.chain = []

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        dest = urlsplit(newurl)
        if dest.scheme != "https" or dest.hostname != self.host or dest.username or dest.password:
            raise ValueError("redirect outside explicitly authorized HTTPS host")
        self.chain.append({"status": code, "url": safe_url(newurl)})
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def inspect(url):
    original = safe_url(url)
    if not original:
        raise ValueError("expected HTTPS URL without user information")
    handler = RestrictedRedirect(urlsplit(url).hostname)
    opener = build_opener(handler)
    request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "text/html"})
    with opener.open(request, timeout=20) as response:
        if response.headers.get_content_type() != "text/html":
            raise ValueError("response is not HTML")
        raw = response.read(1_000_001)
        if len(raw) > 1_000_000:
            raise ValueError("response exceeds limit")
        html = raw.decode(response.headers.get_content_charset() or "utf-8", "replace")
        final_url = safe_url(response.geturl())
        status = response.status
    page = Page()
    page.feed(html)
    title = " ".join(" ".join(page.title).split())[:200]
    body = " ".join(" ".join(page.text).split())
    restriction = any(x in title for x in ("验证码", "安全验证", "访问限制", "登录"))
    closed = any(x in title for x in ("信息已删除", "职位已关闭", "职位不存在", "岗位已下线"))
    controls = []
    for control in page.controls:
        label = control["text"]
        if any(word in label for word in ("投递", "申请", "报名", "招聘", "职位", "岗位")):
            href = control["href"]
            destination = safe_url(urljoin(url, href)) if href and not href.startswith(("#", "javascript:")) else None
            controls.append({"label": label[:100], "tag": control["tag"], "href": destination,
                             "requires_review": destination is None})
    # A URL in prose is a lead, not evidence of a working application.
    leads = []
    for match in re.findall(r'https://[^\s<>"\']+', body):
        lead = safe_url(match.rstrip("。，；、)）"))
        if lead and lead not in leads:
            leads.append(lead)
    return {"requested_url": original, "status_code": status, "redirects": handler.chain,
            "final_url": final_url, "title": title, "visible_text_chars": len(body),
            "job_responsibilities_mentioned": any(x in body for x in ("岗位职责", "工作职责")),
            "jobs_mentioned": any(x in body for x in ("招聘岗位", "岗位职责", "职位列表")),
            "restriction_in_title": restriction, "removed_or_closed_in_title": closed,
            "application_controls": controls, "public_https_leads": leads,
            "recruitment_status": "pending_verification",
            "note": "仅检查静态 HTML；可见性、按钮动作、职位和招聘状态需进一步核验。"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="Explicitly authorized public HTTPS page")
    args = parser.parse_args()
    try:
        print(json.dumps(inspect(args.url), ensure_ascii=False, indent=2))
    except Exception as exc:
        # Exceptions can embed sensitive URLs; do not print their messages.
        result = {"error_type": type(exc).__name__, "status": "pending_verification"}
        if isinstance(exc, HTTPError):
            result["http_status"] = exc.code
        print(json.dumps(result))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
