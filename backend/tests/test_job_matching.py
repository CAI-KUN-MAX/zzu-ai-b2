import asyncio
import io
import json
import os
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from docx import Document
from fixture_client import FixtureClient as TestClient

from app.main import app
from app.job_repository import JobRepository
from app.job_matching import base_scores
from app.job_schemas import Job, JobMatchTask, MatchContext
from app.mock_data import MOCK_RESPONSES
from app.schemas import DiagnoseResponse
from test_interviews import ANSWER, completion, model_output
from scripts.check_job_catalogue import check as check_catalogue

TEXT = "某大学计算机本科，熟悉Python、MySQL和FastAPI，使用Docker部署后端接口，参与单元测试与团队协作。"
JD = "本科及以上学历，计算机相关专业，要求熟悉Python和MySQL，掌握FastAPI接口开发，参与Docker部署和单元测试。"


def fixture_job(identifier, jd=JD, category="计算机", education="本科", status="open"):
    return dict(job_id=identifier, title="测试" + identifier, company="虚构测试公司", cities=["北京"],
                category=category, education=education, education_requirement=education + "及以上",
                majors=["测试专业"], graduation_year="2027", jd_text=jd,
                source_url="https://example.com/" + identifier, published_at="2026-10-01",
                publication_type="original", application_url="https://example.com/apply",
                verified_at="2026-10-26T12:00:00+08:00", application_status=status,
                verification_note="虚构测试夹具，不计入真实岗位集")


class JobMatchingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {"DATA_DIR": self.directory.name,
                                                   "MATCH_LLM_TOP_K": "0", "MOCK_MODE": "false",
                                                   "JOB_EMBEDDING_ENABLED": "false",
                                                   "OCR_PROVIDER": "stub"})
        self.environment.start()
        self.client_context = TestClient(app)
        self.client = self.client_context.__enter__()
        jobs = [fixture_job("a"), fixture_job("b"), fixture_job("c",
                "本科及以上学历，新闻传播专业，负责新闻采写、媒体采访、内容编辑及发布，具备文字写作和沟通能力。", "外语传播"),
                fixture_job("closed", status="closed")]
        app.state.job_repository.jobs = {job["job_id"]: Job.model_validate(job) for job in jobs}
        with app.state.store.connect() as db:
            db.execute("INSERT INTO resumes (id,name,sha256,file_path,source,text,chars,status,created_at) "
                       "VALUES ('r','原简历.docx','r','unused','docx',?,?,'ready','now')", (TEXT, len(TEXT)))

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.environment.stop()
        self.directory.cleanup()

    def create(self, ids=None, resume="r"):
        response = self.client.post("/api/job-matches", json={"resume_id": resume, "job_ids": ids or ["b", "a", "c"]})
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()["task_id"]

    def wait(self, identifier):
        for _ in range(300):
            response = self.client.get("/api/job-matches/" + identifier)
            self.assertEqual(response.status_code, 200, response.text)
            result = response.json()
            JobMatchTask.model_validate(result)
            if result["status"] in {"succeeded", "failed"}:
                return result
            time.sleep(.01)
        self.fail("job matching did not terminate")

    def test_catalogue_filters_paging_and_detail(self):
        response = self.client.get("/api/jobs").json()
        self.assertEqual(response["total"], 3)
        self.assertEqual(self.client.get("/api/jobs?category=外语传播&education=本科").json()["total"], 1)
        self.assertEqual(self.client.get("/api/jobs?application_status=closed").json()["total"], 1)
        self.assertEqual(len(self.client.get("/api/jobs?page=2&page_size=2").json()["items"]), 1)
        self.assertEqual(self.client.get("/api/jobs/a").json()["jd_text"], JD)
        detail = self.client.get("/api/jobs/a").json()
        self.assertEqual(detail["source_url"], "https://example.com/a")
        self.assertEqual(detail["application_url"], "https://example.com/apply")
        self.assertNotEqual(detail["source_url"], detail["application_url"])
        self.assertEqual(detail["application_status"], "open")
        self.assertTrue(detail["verified_at"])
        for query in ("page=0", "page_size=101", "category=其他", "education=高中", "application_status=bad"):
            self.assertEqual(self.client.get("/api/jobs?" + query).status_code, 422)
        self.assertEqual(self.client.get("/api/jobs/nope").status_code, 404)

    def test_embedding_changes_ranking_and_reports_failure_for_retry(self):
        from app.job_embedding import EmbeddingError
        with patch.dict(os.environ, {"JOB_EMBEDDING_ENABLED": "true"}), \
             patch("app.job_embedding.similarities", new=AsyncMock(return_value=[0.2, 0.9, 0.5])):
            first = self.create()
            result = self.wait(first)
            self.assertEqual(result["embedding_status"], "succeeded")
            items = {item["job_id"]: item for item in result["items"]}
            self.assertEqual(items["b"]["embedding_similarity"], 0.9)
            self.assertGreater(items["b"]["stage1_score"], items["a"]["stage1_score"])
            self.assertEqual(items["a"]["rule_score"], items["b"]["rule_score"])
        with patch.dict(os.environ, {"JOB_EMBEDDING_ENABLED": "true"}), \
             patch("app.job_embedding.similarities", new=AsyncMock(side_effect=EmbeddingError("timeout"))):
            failed = self.create(["a"])
            result = self.wait(failed)
            self.assertEqual((result["embedding_status"], result["embedding_error"]), ("degraded", "timeout"))
            self.assertEqual(result["items"][0]["stage1_score"], result["items"][0]["rule_score"])
            self.assertIsNone(result["items"][0]["embedding_similarity"])
            self.assertNotEqual(failed, self.create(["a"]))

    def test_unverified_complete_jobs_are_listed_and_matchable(self):
        jd = "岗位职责：参与分子检测实验、整理数据并优化试验流程，与研发团队核对分析结果，记录样本处理和检测质量问题。任职要求：生物学硕士，掌握分子实验和数据分析方法，能够阅读英文文献并编写报告，具备跨团队沟通能力。"
        candidate = fixture_job("candidate", jd, "生物医药", "硕士", "unverified")
        candidate["application_url"] = None
        app.state.job_repository.jobs["candidate"] = Job.model_validate(candidate)
        listing = self.client.get("/api/jobs/testing-pool").json()
        self.assertEqual(listing["total"], 1)
        self.assertIsNone(listing["items"][0]["application_url"])
        default_items = self.client.get("/api/jobs").json()["items"]
        self.assertEqual(next(item for item in default_items if item["job_id"] == "candidate")["application_status"], "unverified")
        self.assertNotIn("closed", [item["job_id"] for item in default_items])
        request = {"resume_id": "r", "job_ids": ["candidate"]}
        response = self.client.post("/api/job-matches", json=request)
        self.assertEqual(response.status_code, 202, response.text)
        self.assertEqual(self.wait(response.json()["task_id"])["status"], "succeeded")
        request["allow_unverified_for_testing"] = True
        self.assertEqual(self.client.post("/api/job-matches", json=request).status_code, 202)
        incomplete = fixture_job("incomplete", "岗位说明不足，需要进一步核对岗位要求、工作职责、专业限制、毕业届别及实际工作城市。", status="unverified")
        incomplete["application_url"] = None
        app.state.job_repository.jobs["incomplete"] = Job.model_validate(incomplete)
        self.assertNotIn("incomplete", [item["job_id"] for item in self.client.get("/api/jobs").json()["items"]])
        request["job_ids"] = ["incomplete"]
        self.assertEqual(self.client.post("/api/job-matches", json=request).status_code, 409)
        request["job_ids"] = ["closed"]
        self.assertEqual(self.client.post("/api/job-matches", json=request).status_code, 409)

    def test_not_resume_is_rejected_before_task_creation(self):
        app.state.store.update("resumes", "r", status="not_resume")
        response = self.client.post("/api/job-matches", json={"resume_id": "r", "job_ids": ["a"]})
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["error"]["code"], "CONTENT_MISMATCH")
        with app.state.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM tasks WHERE kind='job_match'").fetchone()[0], 0)

    def test_structured_education_is_scored_when_jd_omits_it(self):
        jd = "负责药理实验、细胞活性检测和实验数据整理，熟悉实验室规范及动物伦理要求。"
        resume = {"id": "r", "name": "", "text": "药学本科毕业，具有细胞实验和数据整理经验。"}
        bachelor = fixture_job("bachelor", jd, education="本科")
        master = fixture_job("master", jd, education="硕士")
        doctorate = fixture_job("doctorate", jd, education="博士")
        scores = {item["job_id"]: item for item in base_scores(resume, [master, bachelor, doctorate])}

        def education(item):
            return next(s["score"] for s in item["subscores"] if s["key"] == "education_match")
        self.assertEqual(education(scores["bachelor"]), 100)
        self.assertEqual(education(scores["master"]), 60)
        self.assertEqual(education(scores["doctorate"]), 30)
        self.assertGreater(scores["bachelor"]["score"], scores["master"]["score"])
        from app.matching import education_score
        self.assertEqual(education_score(jd, resume["text"]), 100)  # 旧单 JD 接口保持原规则

    def test_sort_ties_duplicates_and_idempotency(self):
        with patch("app.matching.run_diagnose") as model:
            task = self.create(["c", "b", "a", "a"])
            self.assertEqual(task, self.create(["a", "c", "b"]))
            result = self.wait(task)
            self.assertEqual(task, self.create())
        model.assert_not_called()
        self.assertEqual([i["job_id"] for i in result["items"]], ["a", "b", "c"])
        self.assertIn("Python", result["items"][0]["matched"])
        for item in result["items"]:
            self.assertEqual(item["degraded_reason"], "ai_disabled")
            self.assertEqual(item["analysis_status"], "degraded")
            self.assertNotIn("report", item)
            self.assertEqual(item["score"], item["stage1_score"])
        self.assertEqual((result["analysis_completed"], result["analysis_total"]), (0, 0))
        self.assertIsNone(result["analysis_started_at"])

    def test_errors_are_atomic_and_task_types_isolated(self):
        for payload, status, code in [({}, 422, "VALIDATION_ERROR"),
                ({"resume_id": "r", "job_ids": []}, 400, "INVALID_INPUT"),
                ({"resume_id": " ", "job_ids": ["a"]}, 400, "INVALID_INPUT"),
                ({"resume_id": "r", "job_ids": ["a"] * 51}, 400, "TOO_MANY_JOBS"),
                ({"resume_id": "r", "job_ids": [1]}, 422, "VALIDATION_ERROR"),
                ({"resume_id": "r", "job_ids": ["a"], "extra": 1}, 422, "VALIDATION_ERROR"),
                ({"resume_id": "missing", "job_ids": ["a"]}, 404, "RESUME_NOT_FOUND"),
                ({"resume_id": "r", "job_ids": ["a", "missing"]}, 404, "JOB_NOT_FOUND"),
                ({"resume_id": "r", "job_ids": ["a", "closed"]}, 409, "JOB_NOT_OPEN")]:
            response = self.client.post("/api/job-matches", json=payload)
            self.assertEqual(response.status_code, status, response.text)
            self.assertEqual(response.json()["error"]["code"], code)
            self.assertTrue(response.json()["error"]["request_id"])
        with app.state.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM tasks WHERE kind!='guest_acl'").fetchone()[0], 0)
        app.state.store.update("resumes", "r", status="parsing")
        self.assertEqual(self.client.post("/api/job-matches", json={"resume_id": "r", "job_ids": ["a"]}).status_code, 409)
        app.state.store.update("resumes", "r", status="ready", text="")
        self.assertEqual(self.client.post("/api/job-matches", json={"resume_id": "r", "job_ids": ["a"]}).status_code, 400)
        self.assertEqual(self.client.get("/api/job-matches/nope").status_code, 404)
        with app.state.store.connect() as db:
            db.execute("INSERT INTO tasks (id,kind,status,created_at,updated_at) VALUES ('old','match','succeeded','now','now')")
        self.assertEqual(self.client.get("/api/job-matches/old").status_code, 404)

    def test_real_ai_rerank_cache_and_singleflight(self):
        async def fake(resume, jd):
            await asyncio.sleep(.025)
            report = MOCK_RESPONSES["medium"].model_copy(deep=True)
            report.meta.mode = "llm"
            report.overall_score = 100 if "新闻" in jd else 0
            return report
        with patch.dict(os.environ, {"MATCH_LLM_TOP_K": "8"}), patch("app.matching.run_diagnose", side_effect=fake) as model:
            first = self.wait(self.create())
            self.assertEqual(model.await_count, 2)  # a/b share identical JD while running
            self.assertEqual(first["items"][0]["job_id"], "c")
            second = self.wait(self.create(["a", "c"]))
            self.assertEqual(model.await_count, 2)  # new task, persistent pair cache
        for item in first["items"] + second["items"]:
            self.assertFalse(item["degraded"])
            DiagnoseResponse.model_validate(item["report"])
            self.assertEqual(item["score"], round(.35 * item["stage1_score"] + .65 * item["report"]["overall_score"]))
        self.assertEqual((first["analysis_completed"], first["analysis_total"]), (3, 3))
        self.assertEqual(datetime.fromisoformat(first["analysis_started_at"]).tzinfo, timezone.utc)

    def test_partial_failure_and_mock_are_degraded(self):
        async def fake(resume, jd):
            if "新闻" in jd:
                raise RuntimeError("model failed")
            return MOCK_RESPONSES["medium"].model_copy(deep=True)
        with patch.dict(os.environ, {"MATCH_LLM_TOP_K": "8"}), patch("app.matching.run_diagnose", side_effect=fake):
            result = self.wait(self.create())
        self.assertEqual(result["status"], "succeeded")
        reasons = {i["job_id"]: i["degraded_reason"] for i in result["items"]}
        self.assertEqual(reasons, {"a": "mock_report", "b": "mock_report", "c": "model_failed"})
        self.assertEqual((result["analysis_completed"], result["analysis_total"]), (3, 3))
        with app.state.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM llm_cache").fetchone()[0], 0)

    def test_single_failure_preserves_other_real_results(self):
        async def fake(resume, jd):
            if "新闻" in jd:
                raise RuntimeError("failed")
            report = MOCK_RESPONSES["medium"].model_copy(deep=True)
            report.meta.mode = "llm"
            return report
        with patch.dict(os.environ, {"MATCH_LLM_TOP_K": "8"}), patch("app.matching.run_diagnose", side_effect=fake):
            result = self.wait(self.create())
        self.assertEqual(sum(not i["degraded"] for i in result["items"]), 2)
        self.assertEqual(next(i for i in result["items"] if i["job_id"] == "c")["degraded_reason"], "model_failed")

    def test_item_timeout_cancel(self):
        cancelled = []
        async def fake(resume, jd):
            try:
                await asyncio.sleep(10)
            finally:
                cancelled.append(True)
        with patch.dict(os.environ, {"MATCH_LLM_TOP_K": "8"}), patch("app.job_matching.ITEM_TIMEOUT", .05), \
                patch("app.matching.run_diagnose", side_effect=fake):
            identifier = self.create()
            result = self.wait(identifier)
        self.assertEqual(len(cancelled), 2)
        self.assertTrue(all(i["degraded_reason"] == "item_timeout" for i in result["items"]))
        self.assertFalse(app.state.match_jobs.inflight)

    def test_pending_state_is_visible_while_analysis_is_blocked(self):
        started = threading.Event()
        release = threading.Event()

        async def blocked(resume, jd):
            started.set()
            while not release.is_set():
                await asyncio.sleep(.01)
            report = MOCK_RESPONSES["medium"].model_copy(deep=True)
            report.meta.mode = "llm"
            return report

        with patch.dict(os.environ, {"MATCH_LLM_TOP_K": "8"}), \
                patch("app.job_matching.ITEM_TIMEOUT", 10), \
                patch("app.matching.run_diagnose", side_effect=blocked):
            try:
                identifier = self.create()
                self.assertTrue(started.wait(5), "analysis did not start")
                current = self.client.get("/api/job-matches/" + identifier).json()
                self.assertTrue(any(i["analysis_status"] in {"pending", "running"} for i in current["items"]))
            finally:
                release.set()
            self.assertEqual(self.wait(identifier)["status"], "succeeded")

    def test_timeout_logs_safe_stage_for_model_and_queue(self):
        async def slow(resume, jd):
            await asyncio.sleep(10)

        class BlockingGate:
            async def __aenter__(self):
                await asyncio.sleep(10)

            async def __aexit__(self, *args):
                return False

        with patch.dict(os.environ, {"MATCH_LLM_TOP_K": "8"}), \
                patch("app.job_matching.ITEM_TIMEOUT", .1), \
                patch("app.matching.run_diagnose", side_effect=slow):
            for gate, phase, job in [(BlockingGate(), "gate_wait", "a"),
                                     (asyncio.Semaphore(1), "diagnose", "c")]:
                app.state.match_jobs.llm_gate = gate
                with self.assertLogs("app.matching", level="WARNING") as logs:
                    identifier = self.create([job])
                    result = self.wait(identifier)
                self.assertEqual(result["items"][0]["degraded_reason"], "item_timeout")
                output = "\n".join(logs.output)
                self.assertIn("phase=" + phase, output)
                self.assertIn("task_id=" + identifier, output)
                self.assertNotIn(TEXT, output)
                self.assertNotIn(JD, output)

    def test_total_timeout_preserves_completed_results(self):
        async def fake(resume, jd):
            if "新闻" in jd:
                await asyncio.sleep(10)
            report = MOCK_RESPONSES["medium"].model_copy(deep=True)
            report.meta.mode = "llm"
            return report
        with patch.dict(os.environ, {"MATCH_LLM_TOP_K": "8"}), patch("app.job_matching.TOTAL_TIMEOUT", .5), \
                patch("app.matching.run_diagnose", side_effect=fake):
            result = self.wait(self.create())
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error_code"], "JOB_MATCH_TIMEOUT")
        self.assertEqual(result["analysis_completed"], 3)
        self.assertEqual(result["analysis_total"], 3)
        self.assertEqual(sum(not i["degraded"] for i in result["items"]), 2)
        self.assertEqual(next(i for i in result["items"] if i["job_id"] == "c")["degraded_reason"], "batch_timeout")
        self.assertFalse(app.state.match_jobs.inflight)

    def test_top_eight_and_input_limits(self):
        for index in range(10):
            job = fixture_job(f"extra-{index}", JD + str(index))
            app.state.job_repository.jobs[job["job_id"]] = Job.model_validate(job)
        with patch.dict(os.environ, {"MATCH_LLM_TOP_K": "99"}), \
                patch("app.matching.run_diagnose", new=AsyncMock(return_value=MOCK_RESPONSES["medium"])) as model:
            result = self.wait(self.create([f"extra-{i}" for i in range(10)]))
        self.assertEqual(model.await_count, 8)
        self.assertEqual(sum(i["degraded_reason"] == "not_selected" for i in result["items"]), 2)
        for text, reason in [("短简历", "input_too_short"), ("字" * 20000, "input_too_long")]:
            app.state.store.update("resumes", "r", text=text)
            with patch.dict(os.environ, {"MATCH_LLM_TOP_K": "8"}), patch("app.matching.run_diagnose") as model:
                result = self.wait(self.create(["a"]))
            model.assert_not_called()
            self.assertEqual(result["items"][0]["degraded_reason"], reason)
            context = self.client.get(f"/api/job-matches/{self.create(['a'])}/items/a/context").json()
            self.assertEqual(context["diagnose_request"]["resume_text"], text)
            response = self.client.post("/api/diagnose", json=context["diagnose_request"])
            self.assertEqual(response.status_code, 400 if reason == "input_too_short" else 413)
            self.assertIn("interview_request", context)

    def test_context_snapshots_and_upload_to_existing_flows(self):
        doc = Document()
        doc.add_paragraph(TEXT)
        stream = io.BytesIO()
        doc.save(stream)
        upload = self.client.post("/api/resumes/batch", files=[("files", ("原简历.docx", stream.getvalue()))])
        for _ in range(200):
            task = self.client.get("/api/tasks/" + upload.json()["task_id"]).json()
            if task["status"] in {"succeeded", "failed"}:
                break
            time.sleep(.01)
        resume_id = task["items"][0]["resume_id"]
        identifier = self.create(["a"], resume_id)
        self.wait(identifier)
        app.state.job_repository.jobs["a"] = Job.model_validate(fixture_job("a", JD + " 新要求"))
        response = self.client.get(f"/api/job-matches/{identifier}/items/a/context")
        context = MatchContext.model_validate(response.json())
        self.assertEqual(context.diagnose_request.jd_text, JD)
        self.assertEqual(context.interview_request.resume_id, resume_id)
        with patch.dict(os.environ, {"MOCK_MODE": "true"}):
            diagnosis = self.client.post("/api/diagnose", json=response.json()["diagnose_request"])
            self.assertEqual(diagnosis.status_code, 200, diagnosis.text)
        model = MagicMock()
        model.__aenter__ = AsyncMock(return_value=model)
        model.__aexit__ = AsyncMock(return_value=False)
        async def generate(**kwargs):
            return completion(model_output(json.loads(kwargs["messages"][1]["content"])))
        model.chat.completions.create = AsyncMock(side_effect=generate)
        with patch.dict(os.environ, {"LLM_API_KEY": "test-key"}), patch("app.interviews.AsyncOpenAI", return_value=model):
            interview = self.client.post("/api/interviews", json=response.json()["interview_request"])
            self.assertEqual(interview.status_code, 201, interview.text)
            session = interview.json()
            stored = app.state.interviews.get(session["interview_id"])
            self.assertEqual(stored["jd_text"], JD)
            self.assertEqual(stored["resume_text"], TEXT)
            question = session["question"]
            for round_number in range(1, 6):
                answer = self.client.post(f"/api/interviews/{session['interview_id']}/answers", json={
                    "question_id": question["id"], "answer_text": ANSWER})
                self.assertEqual(answer.status_code, 200, answer.text)
                self.assertEqual(answer.json()["round"], round_number)
                question = answer.json()["next_question"]
            self.assertEqual(answer.json()["status"], "completed")
            self.assertIsNone(question)
        self.assertEqual(self.client.get(f"/api/job-matches/{identifier}/items/b/context").status_code, 404)
        app.state.store.update("resumes", resume_id, text=TEXT + "变更")
        self.assertEqual(self.client.get(f"/api/job-matches/{identifier}/items/a/context").json()["error"]["code"], "RESUME_CHANGED")

    def test_failure_and_restart_allow_retry(self):
        with patch("app.job_matching.base_scores", side_effect=RuntimeError("failure")):
            first = self.create(["a"])
            self.assertEqual(self.wait(first)["error_code"], "JOB_MATCH_FAILED")
        second = self.create(["a"])
        self.assertNotEqual(first, second)
        self.wait(second)
        with app.state.store.connect() as db:
            db.execute("UPDATE tasks SET status='queued' WHERE id=?", (second,))
        app.state.store.initialize()
        self.assertEqual(self.client.get("/api/job-matches/" + second).json()["error_code"], "TASK_INTERRUPTED")
        third = self.create(["a"])
        self.assertNotEqual(second, third)
        self.wait(third)

    def test_catalogue_rejects_duplicate_ids(self):
        path = Path(self.directory.name) / "catalogue.json"
        path.write_text(json.dumps({"version": "test", "items": [fixture_job("a"), fixture_job("a")]}), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "duplicate"):
            JobRepository(app.state.store, path)

    def test_catalogue_acceptance_rejects_incomplete_open_jd(self):
        path = Path(self.directory.name) / "catalogue.json"
        path.write_text(json.dumps({"version": "test", "items": [fixture_job("short")]}, ensure_ascii=False),
                        encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "incomplete open JD"):
            check_catalogue(path, date(2026, 10, 26))

    def test_concurrent_duplicate_requests_create_one_task(self):
        async def fake(resume, jd):
            await asyncio.sleep(.03)
            report = MOCK_RESPONSES["medium"].model_copy(deep=True)
            report.meta.mode = "llm"
            return report
        with patch.dict(os.environ, {"MATCH_LLM_TOP_K": "8"}), patch("app.matching.run_diagnose", side_effect=fake) as model:
            with ThreadPoolExecutor(max_workers=6) as pool:
                ids = list(pool.map(lambda _: self.create(["a"]), range(12)))
            self.assertEqual(len(set(ids)), 1)
            self.wait(ids[0])
            self.assertEqual(model.await_count, 1)
            with app.state.store.connect() as db:
                self.assertEqual(db.execute("SELECT count(*) FROM tasks WHERE kind='job_match'").fetchone()[0], 1)

    def test_snapshots_and_original_id_are_in_fingerprint(self):
        first = self.create(["a"])
        self.wait(first)
        original = app.state.job_repository.jobs["a"]
        app.state.job_repository.jobs["a"] = original.model_copy(update={"jd_text": JD + " 需要Redis。"})
        second = self.create(["a"])
        self.assertNotEqual(first, second)
        self.wait(second)
        self.assertEqual(self.client.get(f"/api/job-matches/{first}/items/a/context").json()["diagnose_request"]["jd_text"], JD)
        with app.state.store.connect() as db:
            db.execute("INSERT INTO resumes (id,name,sha256,file_path,source,text,chars,status,created_at) "
                       "VALUES ('copy','复制简历.docx','copy','unused','docx',?,?,'ready','now')", (TEXT, len(TEXT)))
        third = self.create(["a"], "copy")
        self.assertNotEqual(second, third)
        self.wait(third)
        self.assertEqual(self.client.get(f"/api/job-matches/{third}/items/a/context").json()["interview_request"]["resume_id"], "copy")

    def test_upstream_timeout_and_total_timeout_before_base_score(self):
        from app.matching import LlmError
        with patch.dict(os.environ, {"MATCH_LLM_TOP_K": "8"}), \
                patch("app.matching.run_diagnose", new=AsyncMock(side_effect=LlmError("diagnose_http_504"))):
            result = self.wait(self.create(["a"]))
        self.assertEqual(result["items"][0]["degraded_reason"], "item_timeout")
        def slow_base(*args):
            time.sleep(.05)
            return []
        with patch("app.job_matching.TOTAL_TIMEOUT", .01), patch("app.job_matching.base_scores", side_effect=slow_base):
            result = self.wait(self.create(["b"]))
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error_code"], "JOB_MATCH_TIMEOUT")

    def test_examples_and_real_catalogue_structure(self):
        from app.job_schemas import JobList
        root = Path(__file__).resolve().parents[1]
        examples = json.loads((root / "examples" / "job_matches.json").read_text(encoding="utf-8"))
        for key in ("queued", "running", "succeeded", "partially_degraded", "fully_degraded", "failed", "interrupted"):
            JobMatchTask.model_validate(examples[key])
        JobList.model_validate(examples["jobs"])
        MatchContext.model_validate(examples["context"])
        catalogue = JobRepository(app.state.store)
        self.assertGreater(len(catalogue.jobs), 0)
        # Coverage remains explicit: quantity, category, education and concrete
        # major distribution are all checked by the catalogue report.
        self.assertEqual(len(catalogue.jobs), len(set(catalogue.jobs)))
        report = check_catalogue(root / "catalogue" / "jobs.v1.json", date(2026, 11, 1))
        self.assertTrue(report["testing_target_met"])
        self.assertGreaterEqual(report["testing_pool"], 40)
        self.assertGreaterEqual(report["open"], 40)
        self.assertTrue(report["major_coverage_met"])
        self.assertTrue(all(report["open_majors_by_category"].values()))
        self.assertTrue(report["target_met"])


if __name__ == "__main__":
    unittest.main()
