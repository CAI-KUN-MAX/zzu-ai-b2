"""History metadata and read-only archives, independent of browser caches."""
import json
import time
from datetime import datetime, timezone
from fastapi import HTTPException


def iso_timestamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat() if isinstance(value, (int, float)) else value


class HistoryService:
    def __init__(self, repository):
        self.repository = repository

    def list(self, owner, kind, page, page_size):
        rows, total = self.repository.summaries(owner, kind, page, page_size)
        return dict(items=rows, total=total, page=page, page_size=page_size)

    def detail(self, owner, kind, identifier):
        found = self.repository.detail(owner, kind, identifier)
        if found is None:
            raise HTTPException(status_code=404, detail={"code": "HISTORY_NOT_FOUND", "message": "记录不存在或不属于当前用户"})
        row, resume, payload, ingest_id = found
        entry = dict(id=identifier, kind=kind, status=row.get("status", ""),
                     created_at=iso_timestamp(row["created_at"]),
                     updated_at=iso_timestamp(row.get("updated_at", row["created_at"])),
                     title=resume["name"], resume_id=resume["id"], resume_name=resume["name"],
                     resume_status=resume["status"], job_ids=[], mode=None,
                     ingest_task_id=ingest_id, round=None, max_rounds=None)
        result = dict(entry=entry)
        if kind == "resume":
            result["resume"] = {key: resume[key] for key in ("name", "status", "text", "chars")}
            result["resume"]["resume_id"] = resume["id"]
        elif kind == "job_match":
            recommendation = bool(payload.get("recommendation"))
            jobs = payload["jobs"]
            if recommendation:
                visible = {i["job_id"] for i in json.loads(row["result"] or "[]")[:8]}
                jobs = [j for j in jobs if j["job_id"] in visible]
            mode = "recommend" if recommendation else "manual"
            entry.update(title="岗位推荐" if recommendation else "岗位匹配", mode=mode,
                         job_ids=[j["job_id"] for j in jobs])
            result["match"] = dict(taskId=identifier, resumeId=resume["id"], resumeName=resume["name"],
                                   resumeStatus=resume["status"] if resume["status"] in {"ready", "need_review"} else "failed",
                                   jobIds=entry["job_ids"], jobIndex={j["job_id"]: j for j in jobs},
                                   savedAt=int(time.time() * 1000), mode=mode)
        else:
            state = json.loads(row["state"])
            expired = row["expires_at"] <= time.time()
            entry.update(title="模拟面试 · " + resume["name"],
                         status="expired" if expired and state["status"] == "active" else state["status"],
                         round=state["round"], max_rounds=5)
            turns = [dict(question=t["question"], answer=t["answer"], feedback=t["response"]["feedback"])
                     for t in state["turns"]]
            result["interview"] = dict(resume_id=resume["id"], resume_name=resume["name"], jd_text=row["jd_text"],
                                       status=state["status"], round=state["round"], max_rounds=5,
                                       expired=expired, turns=turns, question=state.get("question"))
        return result
