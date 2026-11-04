"""Persistent guest capabilities using the existing task store, without login."""
import json
import re
import secrets
import uuid
import hmac

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response
from app.auth import SESSION_COOKIE

COOKIE = "resume_guest"


class GuestAccessMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if path.startswith('/api/') and request.method not in {'GET', 'HEAD', 'OPTIONS'}:
            origin = request.headers.get('origin', '')
            same_origin = str(request.base_url).rstrip('/')
            allowed = set(request.app.state.allowed_origins) | {same_origin}
            csrf = request.cookies.get('resume_csrf', '')
            supplied = request.headers.get('x-csrf-token', '')
            if (origin not in allowed or not re.fullmatch(r'[a-f0-9]{64}', csrf)
                    or not re.fullmatch(r'[a-f0-9]{64}', supplied) or not hmac.compare_digest(csrf, supplied)):
                response = JSONResponse({'error': {'code': 'CSRF_REJECTED', 'message': '请求来源或安全令牌无效', 'request_id': uuid.uuid4().hex}}, status_code=403)
                if path.startswith('/api/auth/'):
                    response.headers['Cache-Control'] = 'no-store'
                return response
        if path.startswith('/api/auth/'):
            if request.method == 'POST' and path in {'/api/auth/register', '/api/auth/login'}:
                address = request.client.host if request.client else 'unknown'
                allowed, retry = request.app.state.auth.allow_attempt(address, path + ':ip')
                if not allowed:
                    response = JSONResponse({'error': {'code': 'RATE_LIMITED', 'message': '请求过于频繁', 'request_id': uuid.uuid4().hex}}, status_code=429, headers={'Retry-After': str(retry), 'Cache-Control': 'no-store'})
                    return response
            response = await call_next(request)
            response.headers['Cache-Control'] = 'no-store'
            if path == '/api/auth/me' and not re.fullmatch(r'[a-f0-9]{64}', request.cookies.get('resume_csrf', '')):
                response.set_cookie('resume_csrf', secrets.token_hex(32), secure=request.url.scheme == 'https', samesite='lax', max_age=86400 * 7)
            return response
        if (not request.url.path.startswith("/api/") or request.method == "OPTIONS"
                or request.url.path == "/api/diagnose" or request.url.path.startswith("/api/jobs")):
            return await call_next(request)
        token = request.cookies.get(COOKIE, "")
        fresh = not re.fullmatch(r"[a-f0-9]{64}", token)
        if fresh:
            token = secrets.token_hex(32)
        store = request.app.state.store
        user = request.app.state.auth.resolve(request.cookies.get(SESSION_COOKIE, ''))
        acl_id = 'user:' + user['id'] if user else 'guest:' + token
        request.state.owner = acl_id
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
        elif request.method == "POST" and path in {"/api/match", "/api/job-matches", "/api/job-recommendations"}:
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
