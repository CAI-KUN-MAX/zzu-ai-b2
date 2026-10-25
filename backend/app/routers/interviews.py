import uuid
import logging

from fastapi import APIRouter, HTTPException, Request

from app.interview_schemas import InterviewAnswer, InterviewAnswerResult, InterviewCreate, InterviewSession

router = APIRouter()
logger = logging.getLogger(__name__)


def rethrow(exc, request_id):
    detail = exc.detail if isinstance(exc.detail, dict) else {
        "code": "INTERVIEW_FAILED", "message": "面试暂时失败，请重试"}
    raise HTTPException(status_code=exc.status_code, detail={**detail, "request_id": request_id}) from None


def internal_error(exc, request_id):
    logger.error("interview request_id=%s category=%s", request_id, type(exc).__name__)
    raise HTTPException(status_code=500, detail={"code": "INTERVIEW_FAILED",
                                              "message": "面试暂时失败，请稍后重试",
                                              "request_id": request_id}) from None


@router.post("/api/interviews", status_code=201, response_model=InterviewSession)
async def create_interview(payload: InterviewCreate, request: Request):
    request_id = uuid.uuid4().hex
    try:
        return await request.app.state.interviews.create(payload, request_id)
    except HTTPException as exc:
        rethrow(exc, request_id)
    except Exception as exc:
        internal_error(exc, request_id)


@router.post("/api/interviews/{interview_id}/answers", response_model=InterviewAnswerResult)
async def submit_answer(interview_id: str, payload: InterviewAnswer, request: Request):
    request_id = uuid.uuid4().hex
    try:
        return await request.app.state.interviews.answer(interview_id, payload, request_id)
    except HTTPException as exc:
        rethrow(exc, request_id)
    except Exception as exc:
        internal_error(exc, request_id)
