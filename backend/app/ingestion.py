"""V1 ingestion: local text extraction, durable state and process-local jobs."""
import asyncio
import json
import logging
import os
import re
import sqlite3
import time
import uuid
import zipfile
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from pypdf import PdfReader

logger = logging.getLogger(__name__)
RESTART_ERROR = {"code": "TASK_INTERRUPTED", "message": "服务重启，任务已中断，请重试"}


class IngestError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.detail = {"code": code, "message": message}


def data_directory():
    # Relative DATA_DIR values are anchored at the repository, never the shell cwd.
    root = Path(__file__).resolve().parents[2]
    path = Path(os.getenv("DATA_DIR", "backend/data"))
    return path if path.is_absolute() else root / path


def clean_text(text):
    lines = text.replace("\u3000", " ").replace("\ufeff", "").replace("\xa0", " ").splitlines()
    counts = Counter(line.strip() for line in lines if line.strip())
    result = []
    for line in lines:
        line = line.strip()
        if re.fullmatch(r"第?\s*\d+\s*页?", line):
            continue
        if line and len(line) <= 20 and counts[line] >= 3:
            continue
        # Only remove standalone watermarks, preserving sentences and contact URLs.
        if re.fullmatch(r"(?:简历编号\s*[:：]?\s*[\w-]*|内部资料|www\.[\w.-]+\.com)", line, re.I):
            continue
        if line or (result and result[-1]):
            result.append(line)
    return "\n".join(result).strip()


def detect_type(path):
    with path.open("rb") as stream:
        header = stream.read(8)
    if header.startswith(b"%PDF-"):
        return "pdf"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if header.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if header.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(path) as archive:
                entries = archive.infolist()
                if sum(item.file_size for item in entries) > 32 * 1024 * 1024:
                    raise IngestError(415, "UNSUPPORTED_FILE", "DOCX 解压后过大，请精简后重试")
                if {"[Content_Types].xml", "word/document.xml"} <= set(archive.namelist()):
                    return "docx"
        except (zipfile.BadZipFile, OSError):
            pass
    raise IngestError(415, "UNSUPPORTED_FILE", "仅支持 PDF、DOCX、PNG、JPG；请勿仅修改文件扩展名")


def extract_text(path, kind, max_pages):
    start = time.monotonic()
    pages = 0
    source = kind
    try:
        if kind == "pdf":
            reader = PdfReader(path)
            if reader.is_encrypted:
                raise IngestError(415, "UNSUPPORTED_FILE", "PDF 已加密，请解密后重新上传")
            pages = len(reader.pages)
            if pages > max_pages:
                raise IngestError(415, "UNSUPPORTED_FILE", f"PDF 最多支持 {max_pages} 页，请拆分后上传")
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
            if not pages or len(text.strip()) / pages < 80:
                raise IngestError(503, "OCR_UNAVAILABLE", "首版尚未启用 OCR，请上传带文本层的 PDF 或 DOCX；扫描件请稍后重试")
            source = "pdf_text"
        elif kind == "docx":
            document = Document(path)
            blocks = []
            for element in document.element.body:
                if element.tag == qn("w:p"):
                    blocks.append(Paragraph(element, document).text)
                elif element.tag == qn("w:tbl"):
                    blocks.extend(" | ".join(cell.text for cell in row.cells)
                                  for row in Table(element, document).rows)
            text = "\n".join(blocks)
        else:
            raise IngestError(503, "OCR_UNAVAILABLE", "首版尚未启用 OCR，图片暂不能识别；请上传带文本层的 PDF 或 DOCX")
    except IngestError:
        raise
    except Exception:
        raise IngestError(415, "UNSUPPORTED_FILE", "文件损坏或内容格式不正确，请重新导出 PDF/DOCX 后上传") from None
    text = clean_text(text)
    if not text:
        raise IngestError(422, "OCR_FAILED", "未识别到任何文字，请检查文件内容后重试")
    return dict(text=text, chars=len(text), pages=pages, source=source, provider="local",
                elapsed_ms=int((time.monotonic() - start) * 1000),
                status="need_review" if len(text) < 30 else "ready", error=None)


class Store:
    def __init__(self, directory):
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "uploads").mkdir(exist_ok=True)
        self.path = directory / "app.db"

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self):
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS resumes (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE,
                    file_path TEXT NOT NULL, source TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
                    chars INTEGER DEFAULT 0, pages INTEGER DEFAULT 0, provider TEXT DEFAULT '',
                    elapsed_ms INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'parsing',
                    error TEXT, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
                    stage TEXT DEFAULT '', progress INTEGER DEFAULT 0, payload TEXT DEFAULT '{}',
                    result TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            """)
        self.interrupt()

    def interrupt(self):
        error = json.dumps(RESTART_ERROR, ensure_ascii=False)
        with self.connect() as db:
            db.execute("UPDATE tasks SET status='failed', stage='任务已中断', error=?, updated_at=? "
                       "WHERE status IN ('queued','running')", (error, now()))
            db.execute("UPDATE resumes SET status='failed', error=? WHERE status='parsing'", (error,))

    def get(self, table, identifier):
        assert table in {"tasks", "resumes"}
        with self.connect() as db:
            row = db.execute(f"SELECT * FROM {table} WHERE id=?", (identifier,)).fetchone()
            return dict(row) if row else None

    def update(self, table, identifier, **fields):
        assert table in {"tasks", "resumes"}
        if table == "tasks":
            fields["updated_at"] = now()
        for key in ("error", "result"):
            if key in fields and fields[key] is not None:
                fields[key] = json.dumps(fields[key], ensure_ascii=False)
        with self.connect() as db:
            db.execute(f"UPDATE {table} SET " + ",".join(f"{key}=?" for key in fields) + " WHERE id=?",
                       [*fields.values(), identifier])

    def enqueue(self, uploads):
        """Files are validated before this transaction; identical bytes share one row."""
        task_id = uuid.uuid4().hex
        ids = []
        with self.connect() as db:
            for upload in uploads:
                existing = db.execute("SELECT id,status FROM resumes WHERE sha256=?", (upload["sha256"],)).fetchone()
                if existing:
                    resume_id = existing["id"]
                    # Failed rows may be retried after OCR is enabled or service restarts.
                    if existing["status"] == "failed":
                        db.execute("UPDATE resumes SET status='parsing',error=NULL WHERE id=?", (resume_id,))
                else:
                    resume_id = uuid.uuid4().hex
                    final = self.directory / "uploads" / upload["sha256"]
                    upload["path"].replace(final)
                    db.execute("INSERT INTO resumes (id,name,sha256,file_path,source,created_at) VALUES (?,?,?,?,?,?)",
                               (resume_id, upload["name"], upload["sha256"], str(final), upload["kind"], now()))
                if resume_id not in ids:
                    ids.append(resume_id)
            db.execute("INSERT INTO tasks (id,kind,status,stage,payload,created_at,updated_at) "
                       "VALUES (?,'ingest','queued','等待解析',?,?,?)",
                       (task_id, json.dumps({"resume_ids": ids}), now(), now()))
        return task_id


def now():
    return datetime.now(timezone.utc).isoformat()


class IngestJobs:
    def __init__(self, store):
        self.store = store
        self.jobs = set()
        # Serialize V1 text batches to guarantee concurrent duplicates extract once.
        self.gate = asyncio.Lock()
        self.max_pages = max(1, int(os.getenv("OCR_MAX_PAGES", "10")))

    def submit(self, identifier):
        job = asyncio.create_task(self.run(identifier))
        self.jobs.add(job)
        job.add_done_callback(self.jobs.discard)

    async def close(self):
        pending = list(self.jobs)
        for job in pending:
            job.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        self.store.interrupt()

    async def run(self, identifier):
        async with self.gate:
            task = self.store.get("tasks", identifier)
            ids = json.loads(task["payload"])["resume_ids"]
            try:
                self.store.update("tasks", identifier, status="running", stage=f"解析 0/{len(ids)}")
                for index, resume_id in enumerate(ids, 1):
                    resume = self.store.get("resumes", resume_id)
                    if resume["status"] == "parsing":
                        try:
                            fields = await asyncio.to_thread(extract_text, Path(resume["file_path"]),
                                                             resume["source"], self.max_pages)
                            self.store.update("resumes", resume_id, **fields)
                        except IngestError as exc:
                            self.store.update("resumes", resume_id, status="failed", error=exc.detail)
                    self.store.update("tasks", identifier, stage=f"解析 {index}/{len(ids)}",
                                      progress=int(index * 100 / len(ids)))
                rows = [self.store.get("resumes", resume_id) for resume_id in ids]
                failed = all(row["status"] == "failed" for row in rows)
                self.store.update("tasks", identifier, status="failed" if failed else "succeeded",
                                  stage="解析失败" if failed else "解析完成", progress=100,
                                  error=json.loads(rows[0]["error"]) if failed else None)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("ingest task failed task_id=%s", identifier)
                error = {"code": "INGEST_FAILED", "message": "解析暂时失败，请重新上传"}
                for resume_id in ids:
                    if self.store.get("resumes", resume_id)["status"] == "parsing":
                        self.store.update("resumes", resume_id, status="failed", error=error)
                self.store.update("tasks", identifier, status="failed", stage="解析失败", error=error)
