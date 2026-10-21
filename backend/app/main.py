import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.routers.diagnose import router

app = FastAPI(title="简历-JD智能诊断系统")

# 允许前端跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def error_response(status, request_id=None):
    code, message = {
        400: ("INVALID_INPUT", "简历或JD文本不能为空"),
        422: ("VALIDATION_ERROR", "请求字段格式不正确"),
        500: ("INTERNAL_ERROR", "诊断暂时失败，请稍后重试"),
        504: ("LLM_TIMEOUT", "模型响应超时，请稍后重试"),
    }.get(status, ("HTTP_ERROR", "请求失败"))
    return JSONResponse(status_code=status, content={"error": {
        "code": code, "message": message, "request_id": request_id or uuid.uuid4().hex,
    }})


@app.exception_handler(HTTPException)
async def handle_http_error(request: Request, exc: HTTPException):
    request_id = exc.detail.get("request_id") if isinstance(exc.detail, dict) else None
    return error_response(exc.status_code, request_id)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, exc: RequestValidationError):
    return error_response(422)


app.include_router(router)

@app.get("/")
def read_root():
    return {"status": "ok"}