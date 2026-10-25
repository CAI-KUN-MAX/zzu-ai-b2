"""Three real-model interview rounds, using only fictional data and a temp DB.

Run from repository root: python backend/scripts/smoke_interviews.py
Optional --output saves the fictional transcript for manual content review.
This uses the existing LLM_API_KEY; it never starts/restarts production services.
"""
import argparse
import io
import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from docx import Document
from fastapi.testclient import TestClient

from app.main import app
from app.interviews import InterviewService


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    sample = json.loads((Path(__file__).resolve().parents[1] / "examples/interview_request.json").read_text(encoding="utf-8"))
    transcript = {"sample": sample, "rounds": []}
    os.environ["MATCH_LLM_TOP_K"] = "0"
    with tempfile.TemporaryDirectory() as directory:
        os.environ["DATA_DIR"] = directory
        with TestClient(app) as client:
            document = Document()
            document.add_paragraph(sample["resume_text"])
            stream = io.BytesIO()
            document.save(stream)
            uploaded = client.post("/api/resumes/batch", files=[("files", ("虚构面试样本.docx", stream.getvalue()))])
            assert uploaded.status_code == 202, uploaded.text
            for _ in range(200):
                ingest = client.get("/api/tasks/" + uploaded.json()["task_id"]).json()
                if ingest["status"] in {"succeeded", "failed"}:
                    break
                time.sleep(.02)
            assert ingest["status"] == "succeeded", ingest.get("error")
            started = time.monotonic()
            created = client.post("/api/interviews", json={"resume_id": ingest["items"][0]["resume_id"],
                                                          "jd_text": sample["jd_text"]})
            assert created.status_code == 201, created.text
            session = created.json()
            transcript["session"] = session
            transcript["create_seconds"] = round(time.monotonic() - started, 2)
            identifier, question = session["interview_id"], session["question"]
            print(json.dumps({"created": True, "seconds": transcript["create_seconds"], "question": question["text"]}, ensure_ascii=False), flush=True)
            for index, answer in enumerate(sample["answers"], 1):
                started = time.monotonic()
                payload = {"question_id": question["id"], "answer_text": answer}
                response = client.post(f"/api/interviews/{identifier}/answers", json=payload)
                assert response.status_code == 200, response.text
                result = response.json()
                assert result["round"] == index
                assert result["status"] == ("completed" if index == 3 else "active")
                replayed = client.post(f"/api/interviews/{identifier}/answers", json=payload)
                assert replayed.status_code == 200 and replayed.json() == result
                item = {"round": index, "question": question, "answer": answer, "response": result,
                        "seconds": round(time.monotonic() - started, 2)}
                transcript["rounds"].append(item)
                print(json.dumps(item, ensure_ascii=False), flush=True)
                question = result["next_question"]
                # Recreate request-scoped service state; persisted replay/progress
                # must survive without depending on any model or in-memory history.
                app.state.interviews = InterviewService(app.state.store, app.state.match_jobs.llm_gate)
            assert question is None
            conflict = client.post(f"/api/interviews/{identifier}/answers", json={"question_id": "not-current", "answer_text": sample["answers"][0]})
            assert conflict.status_code == 409
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(transcript, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"passed": True, "rounds": 3, "replay": "passed", "persistent_state": "passed"}), flush=True)


if __name__ == "__main__":
    main()
