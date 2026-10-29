"""One original resume ranked against immutable catalogue JD snapshots."""
import asyncio
import hashlib
import json
import logging
import os
from datetime import datetime, timezone

from app import matching
from app.job_repository import test_ready
from app.routers.diagnose import MAX_TOTAL_CHARS, MIN_CHARS, SYSTEM_PROMPT
from app.routers.resumes import fail

logger = logging.getLogger(__name__)
SCORING_VERSION = "job-ranking-v2"
ITEM_TIMEOUT = 90
TOTAL_TIMEOUT = 165


def ranked(items):
    return sorted(items, key=lambda item: (-item["score"], item["job_id"]))


def base_scores(resume, jobs):
    items = []
    for job in jobs:
        jd = job["jd_text"]
        item = matching.score_resume(jd, resume, matching.jd_terms(jd), matching.profile2gram(jd),
                                     required_education=job["education"])
        item.pop("resume_id")
        item.pop("name")
        item.update(job_id=job["job_id"], title=job["title"], analysis_status="pending", degraded_reason=None)
        items.append(item)
    return ranked(items)


def readable_resume(repository, identifier):
    row = repository.resume(identifier)
    if not row:
        fail(404, "RESUME_NOT_FOUND", "简历不存在，请重新上传")
    if row["status"] == "not_resume":
        fail(422, "CONTENT_MISMATCH", "文件内容不是可用于岗位匹配的简历，请重新上传")
    if row["status"] not in {"ready", "need_review"}:
        fail(409, "RESUME_NOT_READY", "简历尚未解析完成或解析失败，请重新上传")
    if not row["text"].strip():
        fail(400, "INVALID_INPUT", "简历文本为空，请重新上传")
    return row


class JobMatchService:
    def __init__(self, repository, match_jobs):
        self.repository = repository
        self.match_jobs = match_jobs
        self.jobs = set()

    def create(self, payload):
        if not payload.resume_id.strip() or not payload.job_ids or any(not i.strip() for i in payload.job_ids):
            fail(400, "INVALID_INPUT", "请选择一份简历和至少一个岗位")
        if len(payload.job_ids) > 50:
            fail(400, "TOO_MANY_JOBS", "每次最多匹配 50 个岗位")
        row = readable_resume(self.repository, payload.resume_id)
        jobs = []
        for identifier in sorted(set(payload.job_ids)):
            job = self.repository.jobs.get(identifier)
            if job is None:
                fail(404, "JOB_NOT_FOUND", "岗位不存在")
            if job.application_status != "open" and not (
                payload.allow_unverified_for_testing
                and job.application_status == "unverified"
                and test_ready(job)
            ):
                fail(409, "JOB_NOT_OPEN", "岗位已关闭或尚未核验投递状态")
            jobs.append(job.model_dump(mode="json"))
        # Snapshots are deliberately stored, unlike the older HR-facing match task.
        snapshot = dict(resume_id=row["id"], resume_text=row["text"], jobs=jobs,
                        scoring_version=SCORING_VERSION, prompt_version=matching.PROMPT_VERSION,
                        system_prompt_hash=hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest(),
                        top_k=max(0, min(8, int(os.getenv("MATCH_LLM_TOP_K", "8")))),
                        mock_mode=os.getenv("MOCK_MODE", "false").lower() == "true")
        identifier, created = self.repository.create_or_reuse(snapshot)
        if created:
            task = asyncio.create_task(self.run(identifier, snapshot))
            self.jobs.add(task)
            task.add_done_callback(self.jobs.discard)
        return {"task_id": identifier}

    def task(self, identifier):
        task = self.repository.task(identifier)
        if task is None:
            fail(404, "TASK_NOT_FOUND", "岗位匹配任务不存在")
        return task

    def result(self, identifier):
        task = self.task(identifier)
        error = json.loads(task["error"]) if task["error"] else None
        snapshot = json.loads(task["payload"])
        items = json.loads(task["result"]) if task["result"] else []
        selected = [item for item in items if item.get("degraded_reason") not in {"not_selected", "ai_disabled"}]
        completed = sum(item["analysis_status"] in {"succeeded", "degraded"} for item in selected)
        return dict(status=task["status"], stage=task["stage"], progress=task["progress"],
                    analysis_completed=completed, analysis_total=len(selected),
                    analysis_started_at=snapshot.get("analysis_started_at"),
                    error=error.get("message") if isinstance(error, dict) else error,
                    error_code=error.get("code") if isinstance(error, dict) else None,
                    items=items)

    def context(self, identifier, job_id):
        snapshot = json.loads(self.task(identifier)["payload"])
        job = next((job for job in snapshot["jobs"] if job["job_id"] == job_id), None)
        if job is None:
            fail(404, "JOB_NOT_FOUND", "岗位不属于此匹配任务")
        row = readable_resume(self.repository, snapshot["resume_id"])
        # Interview creation rereads this ID; detect drift instead of silently mixing originals.
        if row["text"] != snapshot["resume_text"]:
            fail(409, "RESUME_CHANGED", "原简历内容已变化，请重新创建岗位匹配")
        return dict(resume_id=snapshot["resume_id"], job_id=job_id,
                    diagnose_request=dict(resume_text=snapshot["resume_text"], jd_text=job["jd_text"]),
                    interview_request=dict(resume_id=snapshot["resume_id"], jd_text=job["jd_text"]))

    async def close(self):
        tasks = list(self.jobs)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def run(self, identifier, snapshot):
        items = []
        async with self.match_jobs.task_gate:
            try:
                self.repository.update(identifier, status="running", stage="基础评分", progress=5)
                async with asyncio.timeout(TOTAL_TIMEOUT):
                    row = dict(id=snapshot["resume_id"], name="", text=snapshot["resume_text"])
                    items = await asyncio.to_thread(base_scores, row, snapshot["jobs"])
                    by_id = {job["job_id"]: job for job in snapshot["jobs"]}
                    top_k = snapshot["top_k"]
                    selected = items[:top_k]
                    for item in items[top_k:]:
                        item.update(analysis_status="degraded", degraded_reason="not_selected" if top_k else "ai_disabled")
                    if selected:
                        payload = {**json.loads(self.repository.task(identifier)["payload"]),
                                   "analysis_started_at": datetime.now(timezone.utc).isoformat()}
                        self.repository.update(identifier, payload=payload)
                    self.repository.update(identifier, result=items,
                                           stage=f"深度分析 0/{len(selected)}" if selected else "基础评分完成",
                                           progress=25)
                    completed = 0

                    async def refine(item):
                        nonlocal completed
                        jd = by_id[item["job_id"]]["jd_text"]
                        text = row["text"]
                        reason = None
                        item["analysis_status"] = "running"
                        self.repository.update(identifier, result=ranked(items))
                        try:
                            if min(len(text.strip()), len(jd.strip())) < MIN_CHARS:
                                reason = "input_too_short"
                            elif len(text.strip()) + len(jd.strip()) > MAX_TOTAL_CHARS:
                                reason = "input_too_long"
                            else:
                                async with asyncio.timeout(ITEM_TIMEOUT):
                                    report = await self.match_jobs.shared_report_for(text, jd)
                                if report.meta.mode != "llm":
                                    reason = "mock_report"
                                else:
                                    score = round(.35 * item["stage1_score"] + .65 * report.overall_score)
                                    item.update(score=score, **matching.level_fields(score), degraded=False,
                                                reason=report.summary, report=report.model_dump(),
                                                analysis_status="succeeded")
                        except asyncio.CancelledError:
                            raise
                        except TimeoutError:
                            reason = "item_timeout"
                        except matching.LlmError as exc:
                            reason = "item_timeout" if str(exc) in {"diagnose_timeout", "diagnose_http_504"} else "model_failed"
                        except Exception:
                            reason = "model_failed"
                        if reason:
                            item.update(analysis_status="degraded", degraded_reason=reason)
                        completed += 1
                        self.repository.update(identifier, result=ranked(items),
                                               stage=f"深度分析 {completed}/{len(selected)}",
                                               progress=25 + int(70 * completed / max(1, len(selected))))

                    async with asyncio.TaskGroup() as group:
                        for item in selected:
                            group.create_task(refine(item))
            except TimeoutError:
                if not items:
                    self.repository.update(identifier, status="failed", stage="基础评分超时",
                                           error={"code": "JOB_MATCH_TIMEOUT", "message": "基础评分超时，请重试"})
                    return
                for item in items:
                    if item["analysis_status"] in {"pending", "running"}:
                        item.update(analysis_status="degraded", degraded_reason="batch_timeout")
                self.repository.update(identifier, status="failed", stage="深度分析超时",
                                       result=ranked(items),
                                       error={"code": "JOB_MATCH_TIMEOUT", "message": "岗位深度分析超时，请重试"})
                return
            except asyncio.CancelledError:
                self.repository.update(identifier, status="failed", stage="任务已中断",
                                       result=ranked(items),
                                       error={"code": "TASK_INTERRUPTED", "message": "服务重启，任务已中断，请重试"})
                raise
            except Exception as exc:
                logger.error("job match failed task_id=%s category=%s", identifier, type(exc).__name__)
                self.repository.update(identifier, status="failed", stage="岗位匹配失败",
                                       result=ranked(items),
                                       error={"code": "JOB_MATCH_FAILED", "message": "岗位匹配暂时失败，请重试"})
                return
            self.repository.update(identifier, status="succeeded", stage="岗位匹配完成", progress=100,
                                   result=ranked(items), error=None)
