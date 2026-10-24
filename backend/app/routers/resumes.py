import asyncio
import hashlib
import json
import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from app.ingestion import IngestError, detect_type

router = APIRouter()


def fail(status, code, message):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


@router.post("/api/resumes/batch", status_code=202)
async def upload_batch(
    request: Request,
    files: list[UploadFile] = File(
        ...,
        alias="files[]",
        # Explicit binary format keeps Swagger's file picker compatible with
        # Pydantic versions that emit only contentMediaType for UploadFile.
        json_schema_extra={"items": {"type": "string", "format": "binary"}},
    ),
):
    paths = []
    uploads = []
    try:
        if not files:
            fail(400, "INVALID_INPUT", "请至少上传一份简历")
        if len(files) > 20:
            fail(400, "TOO_MANY_RESUMES", "每次最多上传 20 份简历")
        limit = min(15, max(1, int(os.getenv("MAX_UPLOAD_MB", "15")))) * 1024 * 1024
        for file in files:
            # Never trust filenames as paths or extensions as file types.
            name = (file.filename or "简历").replace("\\", "/").rsplit("/", 1)[-1][:255] or "简历"
            digest = hashlib.sha256()
            size = 0
            with tempfile.NamedTemporaryFile(dir=request.app.state.store.directory, suffix=".tmp", delete=False) as stream:
                path = Path(stream.name)
                paths.append(path)
                while chunk := await file.read(64 * 1024):
                    size += len(chunk)
                    if size > limit:
                        fail(413, "FILE_TOO_LARGE", f"单份文件不得超过 {limit // (1024 * 1024)}MB")
                    digest.update(chunk)
                    stream.write(chunk)
            if not size:
                fail(400, "INVALID_INPUT", "不能上传空文件")
            kind = await asyncio.to_thread(detect_type, path)
            uploads.append(dict(name=name, sha256=digest.hexdigest(), path=path, kind=kind))
        identifier = request.app.state.store.enqueue(uploads)
        request.app.state.ingest_jobs.submit(identifier)
        return {"task_id": identifier}
    except IngestError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    finally:
        for path in paths:
            path.unlink(missing_ok=True)
        for file in files:
            await file.close()


@router.get("/api/tasks/{task_id}")
async def get_task(task_id: str, request: Request):
    store = request.app.state.store
    task = store.get("tasks", task_id)
    if not task or task["kind"] != "ingest":
        fail(404, "TASK_NOT_FOUND", "任务不存在")
    items = []
    for resume_id in json.loads(task["payload"])["resume_ids"]:
        row = store.get("resumes", resume_id)
        items.append(dict(resume_id=row["id"], name=row["name"], chars=row["chars"],
                          status=row["status"], preview=row["text"][:60],
                          error=json.loads(row["error"]) if row["error"] else None))
    return dict(status=task["status"], stage=task["stage"], progress=task["progress"],
                error=json.loads(task["error"]) if task["error"] else None, items=items)


@router.get("/api/resumes/{resume_id}/text")
async def get_text(resume_id: str, request: Request):
    row = request.app.state.store.get("resumes", resume_id)
    if not row:
        fail(404, "RESUME_NOT_FOUND", "简历不存在")
    if row["status"] == "parsing":
        fail(409, "RESUME_NOT_READY", "简历正在解析，请稍后重试")
    if row["status"] == "failed":
        error = json.loads(row["error"])
        status = {"OCR_UNAVAILABLE": 503, "UNSUPPORTED_FILE": 415, "OCR_FAILED": 422}.get(error["code"], 400)
        raise HTTPException(status_code=status, detail=error)
    return dict(resume_id=row["id"], name=row["name"], chars=row["chars"], text=row["text"])
