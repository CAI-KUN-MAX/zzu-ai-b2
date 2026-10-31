"""Service regression client: explicitly assigns DB-seeded fixtures to its guest.

Isolation tests must use the ordinary TestClient, not this fixture helper.
"""
import re
from fastapi.testclient import TestClient


class FixtureClient(TestClient):
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
