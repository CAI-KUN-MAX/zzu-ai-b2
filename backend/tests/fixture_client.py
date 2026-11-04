"""Service regression client: explicitly assigns DB-seeded fixtures to its guest.

Isolation tests must use the ordinary TestClient, not this fixture helper.
"""
import re
from fastapi.testclient import TestClient


class CsrfClient(TestClient):
    def request(self, method, url, **kwargs):
        if method.upper() not in {'GET', 'HEAD', 'OPTIONS'}:
            if not self.cookies.get('resume_csrf'):
                super().request('GET', '/api/auth/me')
            headers = dict(kwargs.pop('headers', {}) or {})
            headers.setdefault('origin', 'http://testserver')
            headers.setdefault('x-csrf-token', self.cookies.get('resume_csrf'))
            kwargs['headers'] = headers
        return super().request(method, url, **kwargs)


class FixtureClient(CsrfClient):
    def request(self, method, url, **kwargs):
        token = "a" * 64
        self.cookies.set("resume_guest", token)
        identifiers = []
        payload = kwargs.get("json")
        if isinstance(payload, dict):
            if isinstance(payload.get("resume_id"), str):
                identifiers.append(payload["resume_id"])
            if isinstance(payload.get("resume_ids"), list):
                identifiers.extend(value for value in payload["resume_ids"] if isinstance(value, str))
        match = re.match(r"^/api/(?:resumes|tasks|job-matches|match|interviews)/([^/]+)", str(url))
        if match:
            identifiers.append(match[1])
        self.app.state.store.grant_guest("guest:" + token, identifiers)
        return super().request(method, url, **kwargs)
