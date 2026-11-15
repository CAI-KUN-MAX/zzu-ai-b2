from typing import Any, Literal
from pydantic import BaseModel, Field
from app.job_schemas import Job

HistoryKind = Literal["job_match", "resume", "interview"]


class HistoryEntry(BaseModel):
    id: str
    kind: HistoryKind
    status: str
    created_at: str
    updated_at: str
    title: str
    resume_id: str | None = None
    resume_name: str | None = None
    resume_status: str | None = None
    job_ids: list[str] = Field(default_factory=list)
    mode: Literal["manual", "recommend"] | None = None
    ingest_task_id: str | None = None
    round: int | None = None
    max_rounds: int | None = None


class HistoryList(BaseModel):
    items: list[HistoryEntry]
    total: int
    page: int
    page_size: int


class HistoryMatch(BaseModel):
    taskId: str
    resumeId: str
    resumeName: str
    resumeStatus: Literal["ready", "need_review", "failed"]
    jobIds: list[str]
    jobIndex: dict[str, Job]
    savedAt: int
    mode: Literal["manual", "recommend"]


class HistoryResume(BaseModel):
    resume_id: str
    name: str
    status: str
    text: str
    chars: int


class HistoryInterview(BaseModel):
    resume_id: str
    resume_name: str
    jd_text: str
    status: str
    round: int
    max_rounds: int
    expired: bool
    turns: list[dict[str, Any]]
    question: dict[str, Any] | None


class HistoryDetail(BaseModel):
    entry: HistoryEntry
    match: HistoryMatch | None = None
    resume: HistoryResume | None = None
    interview: HistoryInterview | None = None
