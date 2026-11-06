import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.job_matching import JobMatchService


class RecommendationCandidatesTests(unittest.TestCase):
    def test_embedding_can_promote_candidate_beyond_original_top_eight(self):
        async def check():
            jobs = [dict(job_id=f"job-{index:02}", title="测试岗位", education="本科",
                         jd_text="岗位职责：使用 Python 开发系统。任职要求：本科，熟悉 Python。")
                    for index in range(12)]
            snapshot = dict(resume_id="r", resume_text="本科，使用 Python 开发系统。",
                            jobs=jobs, top_k=0, embedding_enabled=True, recommendation=True)
            state = dict(status="running", stage="", progress=0, payload=json.dumps(snapshot),
                         result="[]", error=None)
            repository = MagicMock()
            repository.task.side_effect = lambda identifier: state
            def update(identifier, **fields):
                for key, value in fields.items():
                    state[key] = json.dumps(value) if key in {"payload", "result", "error"} else value
            repository.update.side_effect = update
            shared = SimpleNamespace(task_gate=asyncio.Semaphore(1), llm_gate=asyncio.Semaphore(1))
            service = JobMatchService(repository, shared)
            with patch("app.job_embedding.similarities", new=AsyncMock(return_value=[0.0] * 11 + [1.0])):
                await service.run("t", snapshot)
            result = service.result("t")
            self.assertEqual(result["status"], "succeeded")
            self.assertEqual(result["items"][0]["job_id"], "job-11")
            self.assertEqual(len(result["items"]), 8)
        asyncio.run(check())

    def test_explicit_ux_intent_does_not_exclude_unrecognized_candidates(self):
        repository = MagicMock()
        repository.resume.return_value = {"id": "r", "status": "ready", "text": "本科。求职意向：用户体验设计。"}
        jobs = [dict(job_id="ux", title="用户洞察岗", education="本科", jd_text="负责用户研究。"),
                dict(job_id="unrecognized", title="体验策略师", education="本科", jd_text="分析乘客痛点。")]
        repository.recommendation_candidates.return_value = [
            SimpleNamespace(model_dump=lambda job=job, **kwargs: job) for job in jobs]
        service = JobMatchService(repository, None)
        service.create = MagicMock(return_value={"task_id": "t"})
        result = asyncio.run(service.recommend(SimpleNamespace(resume_id="r", category=None, city=None)))
        self.assertEqual(result, {"task_id": "t"})
        self.assertEqual(set(service.create.call_args.args[0].job_ids), {"ux", "unrecognized"})

    def test_larger_candidate_pool_and_top_eight_response(self):
        repository = MagicMock()
        repository.resume.return_value = {"id": "r", "status": "ready", "text": "本科，Python 项目经历。"}
        jobs = [dict(job_id=f"job-{index:02}", title="测试岗位", education="本科",
                     jd_text="岗位职责：使用 Python 开发系统。任职要求：本科，熟悉 Python。")
                for index in range(12)]
        repository.recommendation_candidates.return_value = [
            SimpleNamespace(model_dump=lambda **kwargs: job) for job in jobs
        ]
        # Bind each model dump to its own value rather than the last loop value.
        for wrapper, job in zip(repository.recommendation_candidates.return_value, jobs):
            wrapper.model_dump = lambda job=job, **kwargs: job
        service = JobMatchService(repository, None)
        service.create = MagicMock(return_value={"task_id": "t"})
        result = asyncio.run(service.recommend(SimpleNamespace(resume_id="r", category=None, city=None)))
        self.assertEqual(result, {"task_id": "t"})
        self.assertEqual(len(service.create.call_args.args[0].job_ids), 12)
        self.assertTrue(service.create.call_args.kwargs["recommendation"])

        items = [{"job_id": job["job_id"], "analysis_status": "degraded",
                  "degraded_reason": "ai_disabled"} for job in jobs]
        repository.task.return_value = dict(status="succeeded", stage="完成", progress=100,
            payload=json.dumps({"recommendation": True}), result=json.dumps(items), error=None)
        self.assertEqual(len(service.result("t")["items"]), 8)
        repository.task.return_value["payload"] = json.dumps({"recommendation": False})
        self.assertEqual(len(service.result("t")["items"]), 12)


if __name__ == "__main__":
    unittest.main()
