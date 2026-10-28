import io
import json
from urllib.parse import quote

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel, StrictStr

from app.routers.resumes import fail

router = APIRouter()


class MatchRequest(BaseModel):
    jd_text: StrictStr
    resume_ids: list[StrictStr]


@router.post("/api/match", status_code=202)
async def create_match(payload: MatchRequest, request: Request):
    jd = payload.jd_text.strip()
    if len(jd) < 30:
        fail(400, "INVALID_INPUT", "岗位 JD 至少需要 30 字")
    if len(jd) > 20000:
        fail(413, "TEXT_TOO_LONG", "岗位 JD 不得超过 20000 字")
    if not payload.resume_ids:
        fail(400, "INVALID_INPUT", "请至少选择一份已解析的简历")
    if len(payload.resume_ids) > 50:
        fail(400, "TOO_MANY_RESUMES", "每次最多匹配 50 份简历")
    rows = []
    for identifier in dict.fromkeys(payload.resume_ids):
        row = request.app.state.store.get("resumes", identifier)
        if not row:
            fail(404, "RESUME_NOT_FOUND", "简历不存在，请重新上传")
        if row["status"] == "not_resume":
            fail(422, "CONTENT_MISMATCH", "文件内容不是可用于匹配的简历，请重新上传")
        if row["status"] not in {"ready", "need_review"}:
            fail(409, "RESUME_NOT_READY", "简历尚未解析完成或解析失败，请重新上传")
        if not row["text"].strip():
            fail(400, "INVALID_INPUT", "简历文本为空，请重新上传")
        rows.append(row)
    return {"task_id": request.app.state.match_jobs.enqueue(jd, rows)}


def match_task(store, identifier):
    task = store.get("tasks", identifier)
    if not task or task["kind"] != "match":
        fail(404, "TASK_NOT_FOUND", "匹配任务不存在")
    return task


@router.get("/api/match/{task_id}")
async def get_match(task_id: str, request: Request):
    task = match_task(request.app.state.store, task_id)
    error = json.loads(task["error"]) if task["error"] else None
    return dict(status=task["status"], stage=task["stage"], progress=task["progress"],
                error=error.get("message") if isinstance(error, dict) else error,
                error_code=error.get("code") if isinstance(error, dict) else None,
                items=json.loads(task["result"]) if task["result"] else [])


def export_workbook(items):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "简历匹配结果"
    sheet.append(["排名", "简历名称", "总分", "匹配等级", "命中关键词", "缺失关键词", "AI 理由", "AI 深度分析"])
    for index, item in enumerate(items, 1):
        values = [index, item["name"], item["score"], item["level_label"],
                      "、".join(item["matched"]), "、".join(item["missing"]),
                      item.get("reason") or "", "未完成" if item["degraded"] else "已完成"]
        sheet.append(["".join(char for char in value if ord(char) >= 32 or char in "\n\t")[:32767]
                      if isinstance(value, str) else value for value in values])
        # User-controlled filenames/text are literal strings, never Excel formulas.
        for cell in sheet[sheet.max_row]:
            if isinstance(cell.value, str):
                cell.data_type = "s"
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    for column, width in zip("ABCDEFGH", (8, 30, 10, 14, 36, 36, 60, 18)):
        sheet.column_dimensions[column].width = width
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer


@router.get("/api/match/{task_id}/export")
async def export_match(task_id: str, request: Request):
    task = match_task(request.app.state.store, task_id)
    if task["status"] != "succeeded":
        fail(409, "TASK_NOT_READY", "匹配尚未完成或任务失败，请完成匹配后再导出")
    buffer = export_workbook(json.loads(task["result"]) if task["result"] else [])
    return StreamingResponse(buffer, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename*=UTF-8''" + quote("简历匹配结果.xlsx")})
