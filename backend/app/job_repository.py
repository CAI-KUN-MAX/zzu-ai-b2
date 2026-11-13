"""Catalogue and task persistence; no schema changes or source-data writes."""
import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.ingestion import now
from app.job_schemas import Job, JobEvidence

CATALOGUE_PATH = Path(__file__).resolve().parents[1] / "catalogue" / "jobs.v1.json"
EVIDENCE_PATH = Path(__file__).resolve().parents[1] / "catalogue" / "job-evidence.v1.json"


def effective_job(job, now=None):
    """Compute independent claims from time-bounded, explicitly recorded evidence."""
    now = now or datetime.now(timezone.utc)
    evidence = job.evidence
    def current(item):
        return item is not None and item.checked_at <= now < item.valid_until

    status = "closed" if job.application_status == "closed" else "unverified"
    if evidence and current(evidence.status):
        status = evidence.status.status
    content = "unknown"
    if (evidence and current(evidence.content) and
            evidence.content.jd_sha256 == hashlib.sha256(job.jd_text.encode("utf-8")).hexdigest()):
        content = evidence.content.completeness
    application_verified = bool(evidence and current(evidence.application) and job.application_url and
                                evidence.application.application_url == job.application_url and status == "open")
    return job.model_copy(update={"effective_status": status, "jd_completeness": content,
                                  "application_verified": application_verified})


def test_ready(job):
    jd = job.jd_text.strip()
    return (job.effective_status != "closed" and job.jd_completeness != "campaign" and len(jd) >= 80
            and "岗位职责：" in jd and "任职要求：" in jd)


class JobRepository:
    def __init__(self, store, path=CATALOGUE_PATH, evidence_path=None):
        self.store = store
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        self.version = data["version"]
        evidence_path = EVIDENCE_PATH if evidence_path is None and Path(path) == CATALOGUE_PATH else evidence_path
        self.evidence_path = Path(evidence_path) if evidence_path else None
        evidence_data = json.loads(Path(evidence_path).read_text(encoding="utf-8")) if evidence_path and Path(evidence_path).exists() else {}
        evidence = {key: JobEvidence.model_validate(value) for key, value in evidence_data.items()}
        jobs = [Job.model_validate({**item, "evidence": evidence.get(item["job_id"])}) for item in data["items"]]
        if set(evidence) - {job.job_id for job in jobs}:
            raise ValueError("evidence references unknown job_id")
        self.jobs = {job.job_id: job for job in jobs}
        if len(self.jobs) != len(jobs):
            raise ValueError("duplicate catalogue job_id")

    @property
    def jobs(self):
        if self.evidence_path:
            raw = json.loads(self.evidence_path.read_text(encoding="utf-8")) if self.evidence_path.exists() else {}
            evidence = {key: JobEvidence.model_validate(value) for key, value in raw.items()}
            if set(evidence) - set(self._jobs):
                raise ValueError("evidence references unknown job_id")
            self._jobs.update({key: effective_job(job.model_copy(update={"evidence": evidence.get(key)}))
                               for key, job in self._jobs.items()})
        else:
            self._jobs.update({key: effective_job(job) for key, job in self._jobs.items()})
        return self._jobs

    @jobs.setter
    def jobs(self, value):
        self._jobs = value

    def list(self, category=None, education=None, application_status=None, page=1, page_size=20):
        items = sorted((job for job in self.jobs.values()
                        if (category is None or job.category == category)
                        and (education is None or job.education == education)
                        and ((job.effective_status == "open" and job.jd_completeness != "campaign" or test_ready(job)) if application_status is None
                             else job.application_status == application_status)),
                       key=lambda job: job.job_id)
        return dict(catalogue_version=self.version, total=len(items), page=page, page_size=page_size,
                    items=items[(page - 1) * page_size:page * page_size])

    def testing_pool(self, category=None, education=None, page=1, page_size=20):
        items = sorted((job for job in self.jobs.values()
                        if test_ready(job) and (category is None or job.category == category)
                        and (education is None or job.education == education)),
                       key=lambda job: job.job_id)
        return dict(catalogue_version=self.version, total=len(items), page=page, page_size=page_size,
                    items=items[(page - 1) * page_size:page * page_size])

    def recommendation_candidates(self, category=None, city=None):
        return [job for job in self.jobs.values()
                if (job.effective_status == "open" and job.jd_completeness != "campaign" or test_ready(job))
                and (category is None or job.category == category)
                and (city is None or city in job.cities)]

    def resume(self, identifier):
        return self.store.get("resumes", identifier)

    def task(self, identifier):
        task = self.store.get("tasks", identifier)
        return task if task and task["kind"] == "job_match" else None

    def create_or_reuse(self, payload):
        canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
        payload = {**payload, "fingerprint": fingerprint}
        # Atomic even when two requests arrive together. No new tables/indexes required.
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for row in db.execute("SELECT id,payload FROM tasks WHERE kind='job_match' "
                                  "AND status IN ('queued','running','succeeded')"):
                existing = json.loads(row["payload"])
                if existing.get("fingerprint") == fingerprint and existing.get("embedding_status") != "degraded":
                    return row["id"], False
            identifier = uuid.uuid4().hex
            db.execute("INSERT INTO tasks (id,kind,status,stage,payload,created_at,updated_at) "
                       "VALUES (?,'job_match','queued','等待岗位匹配',?,?,?)",
                       (identifier, json.dumps(payload, ensure_ascii=False), now(), now()))
        return identifier, True

    def update(self, identifier, **fields):
        if "payload" in fields:
            fields["payload"] = json.dumps(fields["payload"], ensure_ascii=False)
        self.store.update("tasks", identifier, **fields)
