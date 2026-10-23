from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Literal

class DiagnoseRequest(BaseModel):
    resume_text: str = Field(..., min_length=1, description="简历纯文本")
    jd_text: str = Field(..., min_length=1, description="JD纯文本")
    options: Optional[Dict] = Field(default={"language": "zh-CN", "include_suggestions": True})

class DimensionScore(BaseModel):
    key: str
    label: str
    score: int = Field(..., ge=0, le=100) # 强制 0-100
    weight: float

class Highlight(BaseModel):
    title: str
    evidence: str
    source: Literal["resume", "jd"] # 只能是这两个

class Gap(BaseModel):
    title: str
    jd_requirement: str
    resume_evidence: Optional[str] = None
    suggestion: str
    severity: Literal["high", "medium", "low"] # 只能是这三个

class MetaInfo(BaseModel):
    model: str = "mock-model"
    mode: str = "mock"
    elapsed_ms: int = 100

class DiagnoseResponse(BaseModel):
    request_id: str
    overall_score: int = Field(..., ge=0, le=100) # 强制 0-100
    level: Literal["high", "medium", "low"] # 只能是这三个
    level_label: str
    dimension_scores: List[DimensionScore]
    highlights: List[Highlight]
    gaps: List[Gap]
    summary: str
    disclaimer: str = "AI诊断结果仅供参考，请以实际岗位要求为准。"
    meta: MetaInfo

class ErrorDetail(BaseModel):
    code: str
    message: str
    request_id: str

class ErrorResponse(BaseModel):
    error: ErrorDetail