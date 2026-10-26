# 单简历多岗位契约（v1）

本接口与 `/api/match`（一个 JD、多份简历）独立。未接入 Embedding；基础分为技能关键词 55% + 字符 2-gram 余弦相似度 30% + 学历规则 15%，不是语义向量匹配。多岗位匹配的学历分以岗位的结构化最低学历 `education` 为准，避免 JD 摘要遗漏学历导致满分；原 `/api/match` 仍从用户输入的 JD 判断。分数用于相对排序，不是录用概率或资格审查。

## 岗位目录

`GET /api/jobs?category=计算机&education=本科&application_status=open&page=1&page_size=20`

参数均可选；默认 `application_status=open`，page=1、page_size=20（1–100）。education 按岗位最低学历精确筛选，不表示个人资格判定。category 为十个专业大类，详见 OpenAPI。返回 `{catalogue_version,total,page,page_size,items}`；items 为完整岗位，包含 job_id、title、company、cities、category、education、education_requirement、majors、graduation_year、jd_text、source_url、published_at（YYYY-MM-DD）、publication_type（original/repost）、application_url、verified_at、application_status（open/closed/unverified）、verification_note。状态只代表 verified_at 时点的核验；没有自动保鲜承诺。

`GET /api/jobs/{job_id}` 返回单条完整岗位；不存在为 404 JOB_NOT_FOUND。日期不明或 JD 不完整的外部原始记录不进入此目录。可查询已关闭或待核验的完整历史岗位，但创建匹配仅允许 open 岗位。

## 创建、轮询与重试

`POST /api/job-matches`：`{"resume_id":"原简历ID","job_ids":["岗位ID1","岗位ID2"]}`。返回 202 `{"task_id":"任务ID"}`。仅接受 ready/need_review 且非空简历；岗位 ID 原始列表 1–50 项，重复合并。整批验证后创建任务，禁止额外字段。

`GET /api/job-matches/{task_id}` 返回 `{status,stage,progress,error,error_code,items}`。建议每 1–2 秒轮询；基础分完成后 items 全量返回。items 字段及可直接使用的示例见 `examples/job_matches.json`。结果分数降序、同分 job_id 升序；AI 后重新排序。progress 不表示预计剩余时间。

前 8 岗（MATCH_LLM_TOP_K 可降低，0 关闭）共享现有 AI 并发门限；单项预算 90 秒含并发等待，整批自开始处理起 165 秒含基础评分，不含任务排队。真实 AI 成功后 score=round(0.35*stage1_score+0.65*report.overall_score)，否则保持基础分。命中/缺口与 subscores 解释基础评分；report 解释 AI 诊断。

analysis_status：pending/running 表示尚未结束（degraded=true、degraded_reason=null）；succeeded 表示真实 AI 报告完成；degraded 表示已结束降级。degraded_reason：ai_disabled、not_selected、input_too_short、input_too_long、model_failed、item_timeout、batch_timeout、mock_report。降级没有 report，reason=null；不编造 AI 理由。任务级 succeeded 允许部分或全部降级。

同一 resume_id、简历内容、岗位集合与快照及评分/提示词版本的重复请求，复用 queued/running/succeeded 任务；失败任务允许重建。原简历 ID 纳入指纹，保证后续面试使用的仍是原 ID。成功后重复请求是结果重放，不保证再次调用模型；未完成模型调用按输入合并、成功 LLM 报告持久缓存。重启中断任务为 failed/TASK_INTERRUPTED，可重新 POST。仅支持单 worker。

## 诊断与面试

`GET /api/job-matches/{task_id}/items/{job_id}/context` 返回 `{resume_id,job_id,diagnose_request,interview_request}`。两个请求体可分别直接传给 POST /api/diagnose 和 POST /api/interviews；不要求已有 AI 排序报告。任务保存创建时原简历全文与 JD 快照，context 不重新读取目录 JD。

现有诊断仍要求简历/JD 各不少于 30 字且合计不超过 20000 字。context 原样返回，不截断；诊断超限由原接口返回 400 TEXT_TOO_SHORT / 413 TEXT_TOO_LONG，不阻止获取面试请求。面试创建前仍按原接口校验原 resume_id。简历 ID 不存在或已不可读时 context 返回对应 404/409，避免使用失效 ID。

## 错误

统一体：`{"error":{"code":"JOB_NOT_FOUND","message":"岗位不存在","request_id":"请求ID"}}`。

| HTTP | code | 场景 |
|---|---|---|
|400|INVALID_INPUT / TOO_MANY_JOBS|空 ID、空岗位列表 / 原始列表超过 50|
|404|RESUME_NOT_FOUND / JOB_NOT_FOUND / TASK_NOT_FOUND|简历、岗位、任务或任务中的岗位不存在；任务类型不符|
|409|RESUME_NOT_READY / RESUME_CHANGED / JOB_NOT_OPEN|简历解析失败或未完成 / 原简历内容变化需重建匹配 / 岗位非 open|
|422|VALIDATION_ERROR|类型、额外字段、查询参数非法|

内部失败通过轮询返回 failed、JOB_MATCH_FAILED；基础评分尚未完成就耗尽整批预算时为 failed、JOB_MATCH_TIMEOUT；重启返回 failed、TASK_INTERRUPTED。错误不包含原文或模型内部异常。完整请求、排队、运行、成功、部分/全部降级、上下文与错误示例位于独立 JSON，示例数据均为虚构联调夹具，不能计入真实岗位数量。

2026-10-26 质量复核后，真实目录包含 5 条 open 岗位和 45 条 unverified 来源线索；40 岗数量、十类及学历配额尚未验收通过。前端可使用独立示例开发，但不应把示例或 unverified 记录显示为已核验可投。岗位状态以 `verified_at` 时点为准，到达截止日期后需要重新核验。具体缺口见 `catalogue/VALIDATION.md`。
