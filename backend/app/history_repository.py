"""Read-only history queries over existing durable rows and resource grants."""
import json


class HistoryRepository:
    def __init__(self, store):
        self.store = store

    def resources(self, owner):
        row = self.store.get("tasks", owner)
        if not row or row["kind"] != "guest_acl":
            return []
        return [i for i in json.loads(row["payload"]).get("resources", []) if isinstance(i, str)]

    def summaries(self, owner, kind, page, page_size):
        resources = json.dumps(self.resources(owner))
        # Each branch checks both the resource grant and its associated resume.
        # Metadata-only SELECTs avoid loading full resume/JD snapshots for lists.
        resume_access = "r.id IN (SELECT id FROM owned) AND (r.owner IS NULL OR r.owner=:owner)"
        branches = {
            "resume": f"""SELECT r.id,'resume' kind,r.status,r.created_at,r.created_at updated_at,
                r.name title,r.id resume_id,r.name resume_name,r.status resume_status,
                NULL mode,(SELECT t.id FROM tasks t WHERE t.kind='ingest'
                  AND t.id IN (SELECT id FROM owned)
                  AND json_array_length(t.payload,'$.resume_ids')=1
                  AND EXISTS (SELECT 1 FROM json_each(t.payload,'$.resume_ids') x WHERE x.value=r.id)
                  ORDER BY t.created_at DESC,t.id DESC LIMIT 1) ingest_task_id,
                NULL round,NULL max_rounds FROM resumes r WHERE {resume_access}""",
            "job_match": f"""SELECT t.id,'job_match' kind,t.status,t.created_at,t.updated_at,
                CASE WHEN json_extract(t.payload,'$.recommendation') THEN '岗位推荐'
                  WHEN json_extract(t.payload,'$.retry_parent_id') IS NOT NULL THEN '单岗位重新分析'
                  ELSE '岗位匹配' END || ' · ' || CASE WHEN json_extract(t.payload,'$.recommendation')
                    THEN min(COALESCE(json_array_length(t.result),0),8)
                    ELSE json_array_length(t.payload,'$.jobs') END || ' 个岗位' title,
                r.id resume_id,r.name resume_name,r.status resume_status,
                CASE WHEN json_extract(t.payload,'$.recommendation') THEN 'recommend' ELSE 'manual' END mode,
                NULL ingest_task_id,NULL round,NULL max_rounds
                FROM tasks t JOIN resumes r ON r.id=json_extract(t.payload,'$.resume_id')
                WHERE t.kind='job_match' AND t.id IN (SELECT id FROM owned)
                  AND COALESCE(json_extract(t.payload,'$.owner'),:owner)=:owner AND {resume_access}""",
            "interview": f"""SELECT i.id,'interview' kind,
                CASE WHEN json_extract(i.state,'$.status')='active' AND i.expires_at<CAST(strftime('%s','now') AS REAL)
                  THEN 'expired' ELSE json_extract(i.state,'$.status') END status,
                strftime('%Y-%m-%dT%H:%M:%f+00:00',i.created_at,'unixepoch') created_at,
                strftime('%Y-%m-%dT%H:%M:%f+00:00',i.created_at,'unixepoch') updated_at,
                '模拟面试 · ' || r.name title,r.id resume_id,r.name resume_name,r.status resume_status,
                NULL mode,NULL ingest_task_id,json_extract(i.state,'$.round') round,5 max_rounds
                FROM interviews i JOIN resumes r ON r.id=i.resume_id
                WHERE i.id IN (SELECT id FROM owned) AND {resume_access}""",
        }
        selected = branches.values() if kind == "all" else [branches[kind]]
        query = "WITH owned AS (SELECT value id FROM json_each(:resources)), history AS (" + " UNION ALL ".join(selected) + ") "
        params = dict(resources=resources, owner=owner, limit=page_size, offset=(page - 1) * page_size)
        with self.store.connect() as db:
            total = db.execute(query + "SELECT count(*) FROM history", params).fetchone()[0]
            rows = db.execute(query + "SELECT * FROM history ORDER BY julianday(created_at) DESC,id DESC LIMIT :limit OFFSET :offset", params).fetchall()
        return [dict(row) for row in rows], total

    def detail(self, owner, kind, identifier):
        owned = set(self.resources(owner))
        if identifier not in owned:
            return None
        with self.store.connect() as db:
            if kind == "resume":
                row = db.execute("SELECT * FROM resumes WHERE id=?", (identifier,)).fetchone()
            elif kind == "interview":
                row = db.execute("SELECT * FROM interviews WHERE id=?", (identifier,)).fetchone()
            else:
                row = db.execute("SELECT * FROM tasks WHERE id=? AND kind='job_match'", (identifier,)).fetchone()
            if row is None:
                return None
            row = dict(row)
            payload = json.loads(row["payload"]) if kind == "job_match" else None
            if payload and payload.get("owner") not in {None, owner}:
                return None
            resume_id = identifier if kind == "resume" else payload["resume_id"] if payload else row["resume_id"]
            if resume_id not in owned:
                return None
            resume = db.execute("SELECT * FROM resumes WHERE id=?", (resume_id,)).fetchone()
            if not resume or resume["owner"] not in {None, owner}:
                return None
            ingest = db.execute("SELECT id,payload FROM tasks WHERE kind='ingest' AND id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC,id DESC", (json.dumps(list(owned)),)).fetchall()
        task_id = next((r["id"] for r in ingest if json.loads(r["payload"]).get("resume_ids", []) == [resume_id]), None)
        return row, dict(resume), payload, task_id
