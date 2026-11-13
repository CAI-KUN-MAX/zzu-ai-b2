import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from app.job_repository import JobRepository, effective_job, test_ready
from app.job_schemas import Job, JobEvidence
from app.matching import cache_key
from test_job_matching import fixture_job

NOW = datetime(2026, 11, 11, tzinfo=timezone.utc)
PROOF = {"source_url": "https://example.com/evidence", "checked_at": "2026-11-01T00:00:00Z", "valid_until": "2026-12-01T00:00:00Z", "note": "虚构测试证据"}

class TrustTests(unittest.TestCase):
    def job(self, status="open", evidence=None):
        jd = "岗位职责：" + "完成软件开发和团队协作。" * 6 + "任职要求：" + "掌握软件开发和数据处理。" * 6
        raw = fixture_job("sample", jd, status=status)
        raw["evidence"] = evidence
        return Job.model_validate(raw)

    def test_legacy_open_and_unverified_are_not_open_but_recommendable(self):
        for status in ("open", "unverified"):
            job = effective_job(self.job(status), NOW)
            self.assertEqual(job.effective_status, "unverified")
            self.assertEqual(job.jd_completeness, "unknown")
            self.assertFalse(job.application_verified)
            self.assertTrue(test_ready(job))

    def test_evidence_is_bounded_and_bound_to_content_and_url(self):
        raw = self.job()
        evidence = {"status": {**PROOF, "status": "open"},
                    "content": {**PROOF, "completeness": "full", "jd_sha256": hashlib.sha256(raw.jd_text.encode()).hexdigest()},
                    "application": {**PROOF, "application_url": raw.application_url}}
        job = effective_job(self.job(evidence=evidence), NOW)
        self.assertEqual((job.effective_status, job.jd_completeness, job.application_verified), ("open", "full", True))
        self.assertEqual(effective_job(job.model_copy(update={"application_url": "https://example.com/other"}), NOW).application_verified, False)
        self.assertEqual(effective_job(job.model_copy(update={"jd_text": job.jd_text + "变化"}), NOW).jd_completeness, "unknown")
        self.assertEqual(effective_job(job, datetime(2027, 1, 1, tzinfo=timezone.utc)).effective_status, "unverified")
        for content in ("summary", "campaign"):
            evidence["content"]["completeness"] = content
            partial = effective_job(self.job(evidence=evidence), NOW)
            self.assertEqual(partial.jd_completeness, content)
            self.assertEqual(test_ready(partial), content == "summary")

    def test_closed_and_invalid_evidence(self):
        job = effective_job(self.job("closed"), NOW)
        self.assertEqual(job.effective_status, "closed")
        self.assertFalse(test_ready(job))
        with self.assertRaises(ValueError):
            JobEvidence.model_validate({"status": {**PROOF, "valid_until": PROOF["checked_at"], "status": "open"}})

    def test_sidecar_reload_and_cache_namespace(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            raw = self.job().model_dump(mode="json", exclude={"evidence", "effective_status", "jd_completeness", "application_verified"})
            (root / "jobs.json").write_text(json.dumps({"version": "test", "items": [raw]}), encoding="utf8")
            side = root / "proof.json"
            side.write_text("{}", encoding="utf8")
            repo = JobRepository(None, root / "jobs.json", side)
            self.assertEqual(repo.jobs["sample"].effective_status, "unverified")
            proof = {**PROOF, "checked_at": "2020-01-01T00:00:00Z", "valid_until": "2100-01-01T00:00:00Z", "status": "closed"}
            side.write_text(json.dumps({"sample": {"status": proof}}), encoding="utf8")
            self.assertEqual(repo.jobs["sample"].effective_status, "closed")
            self.assertEqual(repo.recommendation_candidates(), [])
            side.write_text("{}", encoding="utf8")
            self.assertEqual(repo.jobs["sample"].effective_status, "unverified")
            self.assertNotEqual(cache_key("resume", "jd", "proof1"), cache_key("resume", "jd", "proof2"))
