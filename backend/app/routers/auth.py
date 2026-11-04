"""Registration, login, current identity and logout endpoints."""
import asyncio

from fastapi import APIRouter, HTTPException, Request, Response

from app.auth import SESSION_COOKIE, SESSION_MAX_AGE, UsernameTaken
from app.auth_schemas import Credentials

router = APIRouter(prefix="/api/auth")
# Bound scrypt memory/CPU across requests in this single-worker application.
_hash_gate = asyncio.Semaphore(4)


def _set_cookie(response, request, token):
    response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_MAX_AGE, httponly=True,
                        secure=request.url.scheme == "https", samesite="lax", path="/")
    response.headers["Cache-Control"] = "no-store"


def _limit(request, action, username):
    user_allowed, user_retry = request.app.state.auth.allow_attempt(username, action + ":user", limit=20)
    if not user_allowed:
        raise HTTPException(status_code=429, detail={"code": "RATE_LIMITED", "message": "请求过于频繁"},
                            headers={"Retry-After": str(user_retry)})


@router.post("/register", status_code=201)
async def register(payload: Credentials, request: Request, response: Response):
    _limit(request, "register", payload.username)
    async with _hash_gate:
        try:
            user = await asyncio.to_thread(request.app.state.auth.create_user, payload.username, payload.password)
        except UsernameTaken:
            raise HTTPException(status_code=409, detail={"code": "USERNAME_ALREADY_TAKEN", "message": "用户名已占用"}) from None
    token = request.app.state.auth.new_session(user["id"], request.cookies.get(SESSION_COOKIE, ""))
    _set_cookie(response, request, token)
    return {"user": user}


@router.post("/login")
async def login(payload: Credentials, request: Request, response: Response):
    _limit(request, "login", payload.username)
    async with _hash_gate:
        user = await asyncio.to_thread(request.app.state.auth.authenticate, payload.username, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail={"code": "INVALID_CREDENTIALS", "message": "用户名或密码错误"})
    token = request.app.state.auth.new_session(user["id"], request.cookies.get(SESSION_COOKIE, ""))
    _set_cookie(response, request, token)
    return {"user": user}


@router.get("/me")
async def me(request: Request, response: Response):
    user = request.app.state.auth.resolve(request.cookies.get(SESSION_COOKIE, ""))
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated": user is not None, "user": user}


@router.post("/logout")
async def logout(request: Request, response: Response):
    request.app.state.auth.revoke(request.cookies.get(SESSION_COOKIE, ""))
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True,
                           secure=request.url.scheme == "https", samesite="lax")
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True}
