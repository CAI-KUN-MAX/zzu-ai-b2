from typing import Literal
from fastapi import APIRouter, Query, Request, Response
from app.history_schemas import HistoryDetail, HistoryKind, HistoryList

router = APIRouter()


@router.get("/api/history", response_model=HistoryList)
def list_history(request: Request, response: Response,
                 kind: Literal["all", "job_match", "resume", "interview"] = "all",
                 page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=50)):
    response.headers["Cache-Control"] = "no-store"
    return request.app.state.history.list(request.state.owner, kind, page, page_size)


@router.get("/api/history/{kind}/{identifier}", response_model=HistoryDetail, response_model_exclude_none=True)
def history_detail(kind: HistoryKind, identifier: str, request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return request.app.state.history.detail(request.state.owner, kind, identifier)
