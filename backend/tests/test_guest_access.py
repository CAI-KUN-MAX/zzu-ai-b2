import io
import os
import tempfile
import time
import unittest
from unittest.mock import patch

from docx import Document
from fastapi.testclient import TestClient
from app.main import app


class GuestAccessTests(unittest.TestCase):
    def test_upload_owner_stranger_duplicate_and_legacy(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"DATA_DIR": directory, "MATCH_LLM_TOP_K": "0"}):
            with TestClient(app) as owner:
                document = Document()
                document.add_paragraph("姓名：虚构测试 教育背景：某大学计算机本科 专业技能：Python SQL 项目经历：负责后端接口开发与测试。" * 3)
                stream = io.BytesIO()
                document.save(stream)
                content = stream.getvalue()
                uploaded = owner.post("/api/resumes/batch", files={"files": ("test.docx", content)})
                self.assertEqual(uploaded.status_code, 202)
                task_id = uploaded.json()["task_id"]
                for _ in range(200):
                    parsed = owner.get("/api/tasks/" + task_id).json()
                    if parsed["status"] == "succeeded":
                        break
                    time.sleep(.01)
                resume_id = parsed["items"][0]["resume_id"]
                self.assertEqual(owner.get(f"/api/resumes/{resume_id}/text").status_code, 200)
                stranger = TestClient(app)
                denied = stranger.get(f"/api/resumes/{resume_id}/text", headers={"Origin": "http://localhost:5173"})
                self.assertEqual(denied.status_code, 404)
                self.assertEqual(denied.headers["access-control-allow-origin"], "http://localhost:5173")
                self.assertEqual(denied.headers["access-control-allow-credentials"], "true")
                for path in (f"/api/resumes/{resume_id}/text", f"/api/tasks/{task_id}"):
                    self.assertEqual(stranger.get(path).status_code, 404)
                self.assertEqual(stranger.post("/api/interviews", json={"resume_id": resume_id, "jd_text": "岗位要求" * 20}).status_code, 404)
                duplicate = stranger.post("/api/resumes/batch", files={"files": ("copy.docx", content)})
                self.assertEqual(duplicate.status_code, 202)
                self.assertEqual(stranger.get(f"/api/resumes/{resume_id}/text").status_code, 200)
                self.assertEqual(stranger.get("/api/tasks/" + task_id).status_code, 404)
                self.assertEqual(owner.get("/api/tasks/guest:" + stranger.cookies.get("resume_guest")).status_code, 404)
                jobs = owner.get("/api/jobs?page_size=1").json()["items"]
                matched = owner.post("/api/job-matches", json={"resume_id": resume_id, "job_ids": [jobs[0]["job_id"]]})
                self.assertEqual(matched.status_code, 202)
                match_id = matched.json()["task_id"]
                self.assertEqual(stranger.get("/api/job-matches/" + match_id).status_code, 404)
                self.assertEqual(stranger.get(f"/api/job-matches/{match_id}/items/{jobs[0]['job_id']}/context").status_code, 404)
                legacy = owner.post("/api/match", json={"resume_ids": [resume_id], "jd_text": jobs[0]["jd_text"]})
                self.assertEqual(legacy.status_code, 202)
                self.assertEqual(stranger.get(f"/api/match/{legacy.json()['task_id']}/export").status_code, 404)
                self.assertEqual(stranger.post("/api/interviews/unknown/answers", json={"question_id": "q", "answer_text": "回答内容" * 20}).status_code, 404)
                token = owner.cookies.get("resume_guest")
                returning = TestClient(app)
                returning.cookies.set("resume_guest", token)
                self.assertEqual(returning.get(f"/api/resumes/{resume_id}/text").status_code, 200)
