"""Persistent guest capabilities using the existing task store, without login."""
import json
import re
import secrets
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

COOKIE = "resume_guest"


class GuestAccessMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if (not request.url.path.startswith("/api/") or request.method == "OPTIONS"
                or request.url.path == "/api/diagnose" or request.url.path.startswith("/api/jobs")):
            return await call_next(request)
        token = request.cookies.get(COOKIE, "")
        fresh = not re.fullmatch(r"[a-f0-9]{64}", token)
        if fresh:
            token = secrets.token_hex(32)
        store = request.app.state.store
        acl_id = "guest:" + token
        row = store.get("tasks", acl_id)
        owned = set(json.loads(row["payload"]).get("resources", [])) if row else set()
        path = request.url.path
        identifiers = []
        match = re.match(r"^/api/(?:resumes|tasks|job-matches|match|interviews)/([^/]+)", path)
        if request.method == "GET" and match:
            identifiers.append(match[1])
        if request.method == "POST" and path == "/api/interviews":
            try:
                payload = await request.json()
            except (ValueError, UnicodeDecodeError):
                return await call_next(request)
            if isinstance(payload, dict) and isinstance(payload.get("resume_id"), str):
                identifiers.append(payload["resume_id"])
        elif request.method == "POST" and path in {"/api/match", "/api/job-matches"}:
            try:
                payload = await request.json()
            except (ValueError, UnicodeDecodeError):
                return await call_next(request)
            if isinstance(payload, dict):
                values = payload.get("resume_ids", [payload.get("resume_id")])
                if isinstance(values, list):
                    identifiers.extend(value for value in values if isinstance(value, str))
        elif request.method == "POST" and match and path.startswith("/api/interviews/"):
            identifiers.append(match[1])
        if any(identifier not in owned for identifier in identifiers):
            response = JSONResponse({"error": {"code": "RESOURCE_NOT_FOUND", "message": "记录不存在或不属于当前游客，请重新上传简历", "request_id": uuid.uuid4().hex}}, status_code=404)
        else:
            response = await call_next(request)
            if request.method == "POST" and response.status_code in {201, 202}:
                body = b"".join([chunk async for chunk in response.body_iterator])
                data = json.loads(body)
                resources = [data[key] for key in ("task_id", "interview_id") if key in data]
                if path == "/api/resumes/batch" and "task_id" in data:
                    task = store.get("tasks", data["task_id"])
                    resources.extend(json.loads(task["payload"])["resume_ids"])
                store.grant_guest(acl_id, resources)
                response = Response(body, status_code=response.status_code, headers=dict(response.headers), media_type="application/json")
        if fresh:
            response.set_cookie(COOKIE, token, httponly=True, secure=request.url.scheme == "https", samesite="lax", max_age=86400 * 30)
        return response
