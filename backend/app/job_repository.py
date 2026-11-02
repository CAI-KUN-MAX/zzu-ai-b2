"""Catalogue and task persistence; no schema changes or source-data writes."""
import hashlib
import json
import uuid
from pathlib import Path

from app.ingestion import now
from app.job_schemas import Job

CATALOGUE_PATH = Path(__file__).resolve().parents[1] / "catalogue" / "jobs.v1.json"


def test_ready(job):
    jd = job.jd_text.strip()
    return (job.application_status in {"open", "unverified"} and len(jd) >= 80
            and "岗位职责：" in jd and "任职要求：" in jd)


class JobRepository:
    def __init__(self, store, path=CATALOGUE_PATH):
        self.store = store
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        self.version = data["version"]
        jobs = [Job.model_validate(item) for item in data["items"]]
        self.jobs = {job.job_id: job for job in jobs}
        if len(self.jobs) != len(jobs):
            raise ValueError("duplicate catalogue job_id")

    def list(self, category=None, education=None, application_status=None, page=1, page_size=20):
        items = sorted((job for job in self.jobs.values()
                        if (category is None or job.category == category)
                        and (education is None or job.education == education)
                        and ((job.application_status == "open" or test_ready(job)) if application_status is None
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
