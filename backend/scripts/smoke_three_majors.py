"""Live API acceptance with fictional resumes; saves evidence, never deploys."""
import argparse
import io
import json
import time
from pathlib import Path

import httpx
from docx import Document

SAMPLES = {
    "计算机": "姓名：虚构测试甲 教育背景：虚构大学计算机科学与技术本科2027届。专业技能：Python、Java、SQL、MySQL、Docker、Git。项目经历：负责校园预约系统后端接口开发，使用Python进行数据处理，编写单元测试，优化数据库查询。实习经历：参与软件系统测试与接口联调，记录问题并验证修复。",
    "经管财会": "姓名：虚构测试乙 教育背景：虚构大学会计学本科2027届。专业技能：Excel、财务分析、会计核算、审计、财务报表。实习经历：负责核对会计凭证、整理审计工作底稿，参与财务报表检查。项目经历：分析模拟企业资产负债表与现金流量，使用Excel制作预算并检查账目差异。",
    "艺术设计": "姓名：虚构测试丙 教育背景：虚构艺术学院视觉传达设计本科2027届。专业技能：Figma、Photoshop、Illustrator、交互设计、用户研究。项目经历：负责校园服务应用界面设计，通过用户访谈整理需求，制作交互原型并组织可用性测试。实习经历：参与品牌视觉设计、海报和包装设计，记录反馈并迭代作品。",
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="https://8.163.105.39")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    evidence = {"base": args.base, "samples": [], "model_calls": "live API, no provider mocks"}
    def save():
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    with httpx.Client(base_url=args.base, verify=False, timeout=100) as client:
        def get(path):
            response = client.get(path)
            response.raise_for_status()
            return response.json()
        def post(path, **kwargs):
            for attempt in range(3):
                response = client.post(path, **kwargs)
                if response.status_code >= 500:
                    evidence.setdefault("request_failures", []).append({"path": path, "status": response.status_code, "attempt": attempt + 1})
                    save()
                    if attempt < 2:
                        continue
                response.raise_for_status()
                return response.json()
        def poll(path):
            deadline = time.monotonic() + 210
            while time.monotonic() < deadline:
                result = get(path)
                if result["status"] in {"succeeded", "failed"}:
                    return result
                time.sleep(1)
            raise TimeoutError(path)
        jobs = get("/api/jobs?page_size=100")["items"]
        selected = [next(j for j in jobs if j["category"] == category) for category in SAMPLES]
        evidence["jobs"] = selected
        for category, text in SAMPLES.items():
            item = {"major": category, "resume": text, "rounds": []}
            evidence["samples"].append(item)
            save()
            document = Document()
            document.add_paragraph(text)
            stream = io.BytesIO()
            document.save(stream)
            uploaded = post("/api/resumes/batch", files={"files": (f"虚构测试_{category}.docx", stream.getvalue())})
            item["ingest"] = poll("/api/tasks/" + uploaded["task_id"])
            resume = item["ingest"]["items"][0]
            assert resume["status"] in {"ready", "need_review"}, resume
            task = post("/api/job-matches", json={"resume_id": resume["resume_id"], "job_ids": [j["job_id"] for j in selected]})
            item["matching"] = poll("/api/job-matches/" + task["task_id"])
            save()
            own = next(j for j in selected if j["category"] == category)
            item["job_detail"] = get("/api/jobs/" + own["job_id"])
            context = get(f"/api/job-matches/{task['task_id']}/items/{own['job_id']}/context")
            assert context["interview_request"]["resume_id"] == resume["resume_id"]
            assert context["interview_request"]["jd_text"] == own["jd_text"]
            session = post("/api/interviews", json=context["interview_request"])
            question = session["question"]
            for round_number in range(1, 6):
                answer = f"这是虚构测试回答。我在{category}项目中先确认需求与验收标准，再拆分任务并收集原始证据。遇到问题先复现并分析原因，记录修改过程，最后通过测试和同学反馈检查结果，并说明仍未验证的限制。第{round_number}轮。"
                result = post(f"/api/interviews/{session['interview_id']}/answers", json={"question_id": question["id"], "answer_text": answer})
                item["rounds"].append({"question": question, "answer": answer, "result": result})
                question = result["next_question"]
                save()
                print(f"{category}: round {round_number}, {result['status']}", flush=True)
            assert result["status"] == "completed"
            with httpx.Client(base_url=args.base, verify=False) as stranger:
                isolation = stranger.get(f"/api/resumes/{resume['resume_id']}/text")
                item["other_guest_resume_read_status"] = isolation.status_code
            save()
    print("Evidence saved:", args.output, flush=True)


if __name__ == "__main__":
    main()
