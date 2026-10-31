import os
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.routers.diagnose import router
from app.routers.resumes import router as resumes_router
from app.ingestion import IngestJobs, Store, data_directory
from app.matching import MatchJobs
from app.routers.match import router as match_router
from app.interviews import InterviewService
from app.routers.interviews import router as interviews_router
from app.job_repository import JobRepository
from app.job_matching import JobMatchService
from app.guest_access import GuestAccessMiddleware
from app.routers.jobs import router as jobs_router


@asynccontextmanager
async def lifespan(app):
    app.state.store = Store(data_directory())
    app.state.store.initialize()
    app.state.ingest_jobs = IngestJobs(app.state.store)
    app.state.match_jobs = MatchJobs(app.state.store)
    app.state.job_repository = JobRepository(app.state.store)
    app.state.job_matches = JobMatchService(app.state.job_repository, app.state.match_jobs)
    app.state.interviews = InterviewService(app.state.store, app.state.match_jobs.llm_gate)
    try:
        yield
    finally:
        await app.state.job_matches.close()
        await app.state.match_jobs.close()
        await app.state.ingest_jobs.close()

# 线上默认关闭 /docs、/redoc、/openapi.json，本地调试时设 ENABLE_DOCS=true
ENABLE_DOCS = os.getenv("ENABLE_DOCS", "false").lower() == "true"
app = FastAPI(
    lifespan=lifespan,
    title="简历-JD智能诊断系统",
    docs_url="/docs" if ENABLE_DOCS else None,
    redoc_url="/redoc" if ENABLE_DOCS else None,
    openapi_url="/openapi.json" if ENABLE_DOCS else None,
)

# 只允许可信前端跨域携带游客 Cookie；多个地址用英文逗号分隔。
CORS_ORIGINS = [origin.strip() for origin in os.getenv(
    "CORS_ORIGINS", "https://8.163.105.39,http://localhost:5173,http://127.0.0.1:5173"
).split(",") if origin.strip()]
if "*" in CORS_ORIGINS:
    raise ValueError("CORS_ORIGINS cannot contain '*' with guest credentials")
app.add_middleware(GuestAccessMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)

def error_response(status, request_id=None, code=None, message=None):
    default_code, default_message = {
        400: ("INVALID_INPUT", "简历或JD文本不能为空"),
        413: ("TEXT_TOO_LONG", "简历与JD总字数超过上限"),
        422: ("VALIDATION_ERROR", "请求字段格式不正确"),
        500: ("INTERNAL_ERROR", "诊断暂时失败，请稍后重试"),
        504: ("LLM_TIMEOUT", "模型响应超时，请稍后重试"),
    }.get(status, ("HTTP_ERROR", "请求失败"))
    return JSONResponse(status_code=status, content={"error": {
        "code": code or default_code, "message": message or default_message,
        "request_id": request_id or uuid.uuid4().hex,
    }})


@app.exception_handler(HTTPException)
async def handle_http_error(request: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {}
    return error_response(exc.status_code, detail.get("request_id"), detail.get("code"), detail.get("message"))


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, exc: RequestValidationError):
    return error_response(422)


app.include_router(router)
app.include_router(resumes_router)
app.include_router(match_router)
app.include_router(interviews_router)
app.include_router(jobs_router)

@app.get("/")
def read_root():
    return {"status": "ok"}
