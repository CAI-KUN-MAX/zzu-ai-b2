"""Public contract for the job catalogue and one-resume/many-jobs ranking."""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictStr, model_validator

from app.interview_schemas import InterviewCreate
from app.schemas import DiagnoseRequest, DiagnoseResponse, DimensionScore

Category = Literal["计算机", "电子机械", "土木建筑", "化工材料", "生物医药", "经管财会",
                   "文法教育", "外语传播", "艺术设计", "农林环境"]
Education = Literal["不限", "专科", "本科", "硕士", "博士"]
ApplicationStatus = Literal["open", "closed", "unverified"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Job(Contract):
    job_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    company: str = Field(min_length=1)
    cities: list[str] = Field(min_length=1)
    category: Category
    education: Education
    education_requirement: str = Field(min_length=1)
    majors: list[str] = Field(min_length=1)
    graduation_year: str = Field(min_length=1)
    jd_text: str = Field(min_length=30, max_length=20000)
    source_url: str = Field(pattern=r"^https://")
    published_at: date
    publication_type: Literal["original", "repost"]
    application_url: str | None = Field(default=None, pattern=r"^https://")
    verified_at: datetime
    application_status: ApplicationStatus
    verification_note: str = Field(min_length=1)

    @model_validator(mode="after")
    def open_requires_application_url(self):
        if self.application_status == "open" and self.application_url is None:
            raise ValueError("open job requires an application URL")
        return self


class JobList(Contract):
    catalogue_version: str
    total: int
    page: int
    page_size: int
    items: list[Job]


class JobMatchRequest(Contract):
    resume_id: StrictStr
    job_ids: list[StrictStr]
    allow_unverified_for_testing: bool = False


class TaskCreated(Contract):
    task_id: str


class JobMatchItem(Contract):
    job_id: str
    title: str
    score: int = Field(ge=0, le=100)
    stage1_score: int = Field(ge=0, le=100)
    rule_score: int | None = Field(default=None, ge=0, le=100)
    embedding_similarity: float | None = Field(default=None, ge=-1, le=1)
    level: Literal["high", "medium", "low"]
    level_label: str
    subscores: list[DimensionScore]
    matched: list[str]
    missing: list[str]
    reason: str | None
    degraded: bool
    degraded_reason: Literal["ai_disabled", "not_selected", "input_too_short", "input_too_long",
                             "model_failed", "item_timeout", "batch_timeout", "mock_report"] | None
    analysis_status: Literal["pending", "running", "succeeded", "degraded"]
    report: DiagnoseResponse | None = None


class JobMatchTask(Contract):
    status: Literal["queued", "running", "succeeded", "failed"]
    stage: str
    progress: int = Field(ge=0, le=100)
    analysis_completed: int = Field(ge=0)
    analysis_total: int = Field(ge=0)
    analysis_started_at: datetime | None
    embedding_status: Literal["disabled", "pending", "succeeded", "degraded", "unknown"] = "unknown"
    embedding_error: Literal["unavailable", "timeout", "input_too_large", "rate_limited", "authentication_failed", "insufficient_balance", "invalid_vector"] | None = None
    error: str | None
    error_code: str | None
    items: list[JobMatchItem]


class MatchContext(Contract):
    resume_id: str
    job_id: str
    diagnose_request: DiagnoseRequest
    interview_request: InterviewCreate
