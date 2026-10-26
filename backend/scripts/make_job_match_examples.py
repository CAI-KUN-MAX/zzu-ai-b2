"""Generate independent, deterministic frontend fixtures. All people/jobs are fictional."""
from copy import deepcopy
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.job_matching import base_scores, ranked
from app.job_schemas import Job, JobMatchTask, MatchContext
from app.matching import level_fields
from app.schemas import DiagnoseResponse


def examples():
    text = "示例大学计算机本科，熟悉Python和MySQL，使用FastAPI开发课程报名接口，使用Docker部署服务，编写单元测试。"
    jd = "示例岗位要求：本科及以上学历，计算机相关专业，熟悉Python、MySQL和FastAPI，能够使用Docker部署服务并编写单元测试。"
    job = dict(job_id="example-python", title="虚构后端开发岗", company="虚构示例公司",
               cities=["示例城市"], category="计算机", education="本科", education_requirement="本科及以上",
               majors=["计算机相关专业"], graduation_year="2027", jd_text=jd,
               source_url="https://example.com/jobs/python", published_at="2026-10-01", publication_type="original",
               application_url="https://example.com/apply", verified_at="2026-10-26T12:00:00+08:00",
               application_status="open", verification_note="仅供契约演示，非真实可投岗位")
    other = {**job, "job_id": "example-data", "title": "虚构数据开发岗",
             "jd_text": jd + "另外需要掌握Spark数据处理。"}
    for row in (job, other):
        Job.model_validate(row)
    base = base_scores(dict(id="example-resume", name="虚构简历", text=text), [job, other])
    report = DiagnoseResponse.model_validate(dict(
        request_id="example-diagnose", overall_score=80, level="high", level_label="强匹配",
        dimension_scores=[dict(key="skills", label="技能", score=80, weight=1)], highlights=[], gaps=[],
        summary="示例摘要：简历体现Python接口开发经历，需结合具体岗位进一步核对。",
        meta=dict(model="fictional-example-only", mode="llm", elapsed_ms=100)))

    def task(status, items, stage, progress, error=None, error_code=None):
        result = dict(status=status, stage=stage, progress=progress, error=error, error_code=error_code,
                      items=ranked(items))
        JobMatchTask.model_validate(result)
        return result

    success = deepcopy(base)
    for item in success:
        score = round(.35 * item["stage1_score"] + .65 * report.overall_score)
        item.update(score=score, **level_fields(score), degraded=False, degraded_reason=None,
                    analysis_status="succeeded", reason=report.summary, report=report.model_dump())
    partial = deepcopy(success)
    partial[1] = {**deepcopy(base[1]), "degraded_reason": "model_failed", "analysis_status": "degraded"}
    degraded = [{**item, "analysis_status": "degraded", "degraded_reason": "ai_disabled"} for item in deepcopy(base)]
    running = deepcopy(base)
    running[0]["analysis_status"] = "running"
    context = dict(resume_id="example-resume", job_id=job["job_id"],
                   diagnose_request=dict(resume_text=text, jd_text=jd),
                   interview_request=dict(resume_id="example-resume", jd_text=jd))
    MatchContext.model_validate(context)
    errors = []
    for status, code, message in [(400, "INVALID_INPUT", "请选择一份简历和至少一个岗位"),
                                  (400, "TOO_MANY_JOBS", "每次最多匹配50个岗位"),
                                  (404, "RESUME_NOT_FOUND", "简历不存在"), (404, "JOB_NOT_FOUND", "岗位不存在"),
                                  (404, "TASK_NOT_FOUND", "岗位匹配任务不存在"),
                                  (409, "RESUME_NOT_READY", "简历未解析完成"),
                                  (409, "RESUME_CHANGED", "原简历内容已变化，请重新创建岗位匹配"),
                                  (409, "JOB_NOT_OPEN", "岗位已关闭或尚未核验投递状态"),
                                  (422, "VALIDATION_ERROR", "请求字段格式不正确")]:
        errors.append(dict(http_status=status, body=dict(error=dict(code=code, message=message, request_id="example-error"))))
    return dict(note="全部内容为虚构前端联调夹具；llm成功报告也是示例，不是实测结果或真实岗位。",
                request=dict(resume_id="example-resume", job_ids=[job["job_id"], other["job_id"]]),
                created=dict(http_status=202, body=dict(task_id="example-task")),
                jobs=dict(catalogue_version="example-only", total=2, page=1, page_size=20, items=[job, other]),
                queued=task("queued", [], "等待岗位匹配", 0), running=task("running", running, "基础评分完成", 25),
                succeeded=task("succeeded", success, "岗位匹配完成", 100),
                partially_degraded=task("succeeded", partial, "岗位匹配完成", 100),
                fully_degraded=task("succeeded", degraded, "岗位匹配完成", 100),
                failed=task("failed", [], "岗位匹配失败", 5, "岗位匹配暂时失败，请重试", "JOB_MATCH_FAILED"),
                interrupted=task("failed", [], "任务已中断", 0, "服务重启，任务已中断，请重试", "TASK_INTERRUPTED"),
                context=context, errors=errors)


if __name__ == "__main__":
    target = Path(__file__).resolve().parents[1] / "examples" / "job_matches.json"
    target.write_text(json.dumps(examples(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Frontend fixtures generated: " + str(target))
