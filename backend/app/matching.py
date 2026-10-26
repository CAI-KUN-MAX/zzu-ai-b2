"""Reproducible shortlist scoring and bounded reuse of the diagnosis pipeline."""
import asyncio
import hashlib
import importlib
import json
import logging
import math
import os
import re
import uuid
from collections import Counter

from fastapi import HTTPException

from app.ingestion import now
from app.routers.diagnose import (
    CLAUSE_SEPARATOR, EDUCATION_REQUIREMENT, SYSTEM_PROMPT,
    keyword_in_text, requirement_keywords,
)
from app.schemas import DiagnoseRequest, DiagnoseResponse

logger = logging.getLogger(__name__)
PROMPT_VERSION = "screening-v1"
LLM_ITEM_TIMEOUT = 90
MATCH_TOTAL_TIMEOUT = 165
EDUCATION = ((1, r"高中|中专"), (2, r"大专|专科"), (3, r"本科|学士"),
             (4, r"硕士|研究生"), (5, r"博士"))


# 筛选页把关键词直接展示给 HR：去掉 JD 结构词、通用动词和学历词（学历单独计分），
# 以及超过 6 个字的中文长短语（多为整句片段，如“公司招聘系统后端开发”）
SCREENING_STOP_TERMS = {
    "岗位", "岗位职责", "职责", "任职要求", "职位", "职位描述", "公司", "团队", "实习", "实习生",
    "使用", "编写", "设计", "优化", "查询", "开发", "配合", "能够", "协作", "协作开发", "学习",
    "专业", "学历", "本科", "硕士", "博士", "大专", "专科", "研究生", "学士",
}


def is_screening_term(term):
    if term in SCREENING_STOP_TERMS:
        return False
    return term.isascii() or len(term) <= 6


def jd_terms(text):
    counts = Counter()
    spelling = {}
    for clause in CLAUSE_SEPARATOR.split(text):
        terms = filter(is_screening_term, requirement_keywords(clause))
        for term in sorted(terms, key=lambda value: (value.casefold(), value)):
            key = term.casefold()
            counts[key] += 1
            spelling.setdefault(key, term)
    return [spelling[key] for key in sorted(counts, key=lambda key: (-counts[key], key))[:40]]


def education_score(jd, resume):
    if not EDUCATION_REQUIREMENT.search(jd):
        return 100
    required = [rank for rank, pattern in EDUCATION if re.search(pattern, jd)]
    if not required:
        # Certificates/subject requirements cannot be ranked as academic degrees.
        return 100
    actual = [rank for rank, pattern in EDUCATION if re.search(pattern, resume)]
    if not actual:
        return 60
    gap = min(required) - max(actual)
    return 100 if gap <= 0 else 60 if gap == 1 else 30


def profile2gram(text):
    normalized = re.sub(r"\s+", "", text.casefold())
    return Counter(normalized[index:index + 2] for index in range(len(normalized) - 1))


def cosine(left, right):
    denominator = math.sqrt(sum(value * value for value in left.values()) *
                            sum(value * value for value in right.values()))
    return sum(value * right.get(key, 0) for key, value in left.items()) / denominator if denominator else 0


def level_fields(score):
    level = "high" if score >= 80 else "medium" if score >= 60 else "low"
    return {"level": level, "level_label": {"high": "强匹配", "medium": "较匹配", "low": "存在缺口"}[level]}


# OCR 常把同一行的英文词连在一起，如 “PythonFastAPIMySQLGitDocker”。
# 只把“够长且大小写多次切换”的英文串当作粘连串，避免 JavaScript 误命中 Java。
GLUED_RUN = re.compile(r"[A-Za-z0-9+#.]{15,}")
CASE_SWITCH = re.compile(r"[a-z0-9][A-Z]|[A-Z]{2}[a-z]")


def glued_runs(text):
    return [run for run in GLUED_RUN.findall(text) if len(CASE_SWITCH.findall(run)) >= 3]


def keyword_in_resume(term, text, runs):
    if keyword_in_text(term, text):
        return True
    # 粘连串里按原大小写精确查找，至少 3 个字符，减少误命中
    return len(term) >= 3 and term.isascii() and any(term in run for run in runs)


def score_resume(jd, row, terms, jd_profile):
    runs = glued_runs(row["text"])
    matched = [term for term in terms if keyword_in_resume(term, row["text"], runs)]
    missing = [term for term in terms if term not in matched]
    skill = min(1, len(matched) / min(max(len(terms), 1), 15)) * 100
    similarity = cosine(jd_profile, profile2gram(row["text"])) * 100
    education = education_score(jd, row["text"])
    score = round(.55 * skill + .30 * similarity + .15 * education)
    return dict(resume_id=row["id"], name=row["name"], score=score, **level_fields(score),
                stage1_score=score, matched=matched, missing=missing, reason=None, degraded=True,
                subscores=[dict(key=key, label=label, score=round(value), weight=weight) for key, label, value, weight in (
                    ("skill_match", "技能关键词匹配", skill, .55),
                    ("text_similarity", "文本相似度", similarity, .30),
                    ("education_match", "学历匹配", education, .15))])


def ranked(items):
    return sorted(items, key=lambda item: (-item["score"], item["resume_id"]))


def score_batch(jd, rows):
    terms, jd_profile = jd_terms(jd), profile2gram(jd)
    return ranked([score_resume(jd, row, terms, jd_profile) for row in rows])


class LlmError(Exception):
    pass


async def run_diagnose(resume, jd):
    try:
        module = importlib.import_module("app.routers.diagnose")
        async with asyncio.timeout(LLM_ITEM_TIMEOUT):
            return await module.diagnose(DiagnoseRequest(resume_text=resume, jd_text=jd))
    except HTTPException as exc:
        raise LlmError(f"diagnose_http_{exc.status_code}") from None
    except TimeoutError:
        raise LlmError("diagnose_timeout") from None


def cache_key(resume, jd):
    return hashlib.sha256((resume + "\0" + jd + "\0" + PROMPT_VERSION + "\0" + SYSTEM_PROMPT).encode()).hexdigest()


class MatchJobs:
    def __init__(self, store):
        self.store = store
        self.jobs = set()
        self.llm_gate = asyncio.Semaphore(max(1, min(3, int(os.getenv("MATCH_CONCURRENCY", "3")))))
        self.task_gate = asyncio.Semaphore(2)
        self.inflight = {}

    def enqueue(self, jd, rows):
        identifier = uuid.uuid4().hex
        with self.store.connect() as db:
            # Raw JD is request-scoped; persist IDs/results, not another JD entity.
            db.execute("INSERT INTO tasks (id,kind,status,stage,payload,created_at,updated_at) "
                       "VALUES (?,'match','queued','等待匹配',?,?,?)",
                       (identifier, json.dumps({"resume_ids": [row["id"] for row in rows]}), now(), now()))
        task = asyncio.create_task(self.run(identifier, jd, rows))
        self.jobs.add(task)
        task.add_done_callback(self.jobs.discard)
        return identifier

    async def close(self):
        tasks = list(self.jobs)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def cache_get(self, key):
        with self.store.connect() as db:
            row = db.execute("SELECT result FROM llm_cache WHERE key=?", (key,)).fetchone()
        if row:
            try:
                return DiagnoseResponse.model_validate_json(row["result"])
            except ValueError:
                # Ignore a stale/corrupt cached report and use the validated pipeline.
                return None
        return None

    async def shared_report_for(self, resume, jd):
        # Share work across job-ranking requests; cancellation of one caller
        # must not cancel another caller's report. Last waiter cancels the work.
        key = cache_key(resume, jd)
        entry = self.inflight.get(key)
        if entry is None:
            entry = {"task": asyncio.create_task(self.report_for(resume, jd)), "waiters": 0}
            self.inflight[key] = entry
        entry["waiters"] += 1
        try:
            return await asyncio.shield(entry["task"])
        finally:
            entry["waiters"] -= 1
            if not entry["waiters"]:
                if self.inflight.get(key) is entry:
                    self.inflight.pop(key)
                if not entry["task"].done():
                    entry["task"].cancel()
                await asyncio.gather(entry["task"], return_exceptions=True)

    async def report_for(self, resume, jd):
        key = cache_key(resume, jd)
        cached = self.cache_get(key)
        if cached:
            return cached
        async with self.llm_gate:
            cached = self.cache_get(key)
            if cached:
                return cached
            report = DiagnoseResponse.model_validate(await run_diagnose(resume, jd))
            if report.meta.mode == "llm":
                with self.store.connect() as db:
                    db.execute("INSERT OR REPLACE INTO llm_cache (key,result,created_at) VALUES (?,?,?)",
                               (key, report.model_dump_json(), now()))
            return report

    async def run(self, identifier, jd, rows):
        async with self.task_gate:
            try:
                self.store.update("tasks", identifier, status="running", stage="基础评分", progress=5)
                # Long extracted documents must not block polling or diagnosis.
                items = await asyncio.to_thread(score_batch, jd, rows)
                self.store.update("tasks", identifier, result=items, stage="基础评分完成", progress=25)
                by_id = {row["id"]: row for row in rows}
                top_k = max(0, min(8, int(os.getenv("MATCH_LLM_TOP_K", "8"))))
                selected = items[:top_k]
                completed = 0

                async def refine(item):
                    nonlocal completed
                    try:
                        report = await self.report_for(by_id[item["resume_id"]]["text"], jd)
                        final = round(.35 * item["stage1_score"] + .65 * report.overall_score)
                        item.update(score=final, **level_fields(final), degraded=False,
                                    reason=report.summary, report=report.model_dump())
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:
                        # A failed/oversized/short input affects only its own AI report.
                        logger.warning("match degraded task_id=%s resume_id=%s category=%s", identifier,
                                       item["resume_id"], type(exc).__name__)
                    completed += 1
                    self.store.update("tasks", identifier, result=ranked(items),
                                      stage=f"深度分析 {completed}/{len(selected)}",
                                      progress=25 + int(70 * completed / max(1, len(selected))))

                if selected:
                    try:
                        # Keep worst-case analysis bounded even when all model calls stall.
                        async with asyncio.timeout(MATCH_TOTAL_TIMEOUT):
                            async with asyncio.TaskGroup() as group:
                                for item in selected:
                                    group.create_task(refine(item))
                    except TimeoutError:
                        logger.warning("match time budget exhausted task_id=%s", identifier)
                self.store.update("tasks", identifier, status="succeeded", stage="匹配完成", progress=100,
                                  result=ranked(items), error=None)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("match task failed task_id=%s", identifier)
                self.store.update("tasks", identifier, status="failed", stage="匹配失败", error={
                    "code": "MATCH_FAILED", "message": "匹配暂时失败，请重试"})
