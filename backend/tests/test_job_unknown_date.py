import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.job_matching import base_scores
from app.job_repository import JobRepository, test_ready
from app.job_schemas import Job
from app.routers.jobs import router


def sample(identifier):
    return Job.model_validate({
        "job_id": identifier, "title": "虚构后端工程师", "company": "示例公司",
        "cities": ["北京"], "category": "计算机", "education": "本科",
        "education_requirement": "本科及以上", "majors": ["计算机"],
        "graduation_year": "2027", "jd_text": "岗位职责：" + "开发 Python 服务和数据库接口。" * 6
        + "任职要求：" + "计算机本科，熟悉 Python 和 SQL。" * 6,
        "source_url": "https://example.com/job", "published_at": None,
        "collected_at": "2026-11-13T06:37:11Z", "publication_type": "original",
        "application_url": None, "verified_at": "2026-11-13T06:37:11Z",
        "application_status": "unverified", "verification_note": "虚构测试数据",
    })


class UnknownDateTests(unittest.TestCase):
    def test_model_keeps_collection_separate(self):
        job = sample("one")
        self.assertIsNone(job.published_at)
        self.assertIsNotNone(job.collected_at)
        self.assertIsNone(job.application_url)

    def test_api_and_recommendation_accept_undated_job(self):
        repository = JobRepository.__new__(JobRepository)
        repository.version = "synthetic"
        repository.jobs = {str(i): sample(str(i)) for i in range(9)}
        app = FastAPI()
        app.state.job_repository = repository
        app.include_router(router)
        client = TestClient(app)
        response = client.get("/api/jobs/0")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["published_at"])
        self.assertEqual(response.json()["application_status"], "unverified")
        candidates = repository.recommendation_candidates(category="计算机")
        self.assertEqual(len(candidates), 9)
        self.assertTrue(all(test_ready(job) for job in candidates))
        results = base_scores({"id": "synthetic", "name": "", "text": "计算机本科，熟悉 Python 和 SQL。"},
                              [job.model_dump(mode="json") for job in candidates])
        self.assertEqual(len(results[:8]), 8)
        self.assertTrue(all(job.application_status == "unverified" for job in candidates))


if __name__ == "__main__":
    unittest.main()
