# 单简历多岗位契约（v1）

本接口与 `/api/match`（一个 JD、多份简历）独立。规则基础分为技能关键词 55% + 字符 2-gram 余弦相似度 30% + 学历规则 15%。多岗位匹配可使用智谱 Embedding-3 辅助排序；字符相似度本身不是语义向量。学历分以岗位结构化 `education` 为准。分数用于相对排序，不是录用概率或资格审查。

## Embedding 排序

`JOB_EMBEDDING_ENABLED=true` 启用（默认关闭），从 `ZHIPUAI_API_KEY` 读取智谱密钥，使用 `embedding-3`、1024 维，将简历和岗位文本发送至智谱，产生向量接口费用。配置迁移时需单独设置该变量；原 `LLM_API_KEY` 仍供诊断和面试使用。文本按最多 512 字分块、无截断；超过 256 块整批回退。向量按块长加权平均后计算余弦，用同批岗位的语义名次计算百分位（单岗位为 50），`stage1_score=round(0.8*规则分+0.2*语义名次百分位)`；并列相似度使用相同平均名次。该值依赖同批岗位，不能与不同批次或规则评分直接比较，不是录用概率。技能命中、缺口与原有子分数仍解释规则分；学历等硬条件仍应人工核对。Embedding 成功后才按新基础分选择 AI 深度分析岗位。

任务增加 `embedding_status`：`disabled`、`pending`、`succeeded`、`degraded`、`unknown`（旧任务）；`embedding_error` 为 `null` 或 `unavailable`、`timeout`、`input_too_large`、`rate_limited`、`authentication_failed`、`insufficient_balance`、`invalid_vector`。智谱业务错误码 1113 表示欠费，不能把所有 HTTP 429 都当作普通限流；其他无法明确判断的 429 保留 `rate_limited`。每项增加 `rule_score`（规则基础分）及 `embedding_similarity`（原始余弦，-1 至 1；不可用为 null）。服务不可用、限流、超时、输入过长或返回无效向量时整批回退规则分，不混用不同口径；失败任务再次 POST 可重新尝试。只在进程内处理向量，不写入数据库或日志。预算 30 秒，使用共享模型并发门限。旧 `/api/match` 不变。

向量字段的独立虚构示例见 `examples/job_embedding.json`。

## 岗位目录

`GET /api/jobs?category=计算机&education=本科&application_status=open&page=1&page_size=20`

参数均可选；默认 `application_status=open`，page=1、page_size=20（1–100）。education 按岗位最低学历精确筛选，不表示个人资格判定。category 为十个专业大类，详见 OpenAPI。返回 `{catalogue_version,total,page,page_size,items}`；items 为完整岗位，包含 job_id、title、company、cities、category、education、education_requirement、majors、graduation_year、jd_text、source_url、published_at（YYYY-MM-DD）、publication_type（original/repost）、application_url（未核实入口时为 null）、verified_at、application_status（open/closed/unverified）、verification_note。状态只代表 verified_at 时点的核验；没有自动保鲜承诺。

`GET /api/jobs/{job_id}` 返回单条完整岗位；不存在为 404 JOB_NOT_FOUND。来源日期不明的记录不进入此目录。默认只展示已核验可投岗位；`application_status=unverified` 可显式查看真实来源的候选岗位，其中部分历史记录仍只有摘要，不计入测试就绪集。待核验岗位没有明确投递入口时 `application_url=null`，前端不得把 `source_url` 当作投递地址。

`GET /api/jobs/testing-pool?category=生物医药&page=1&page_size=20` 返回用于多专业匹配测试的真实岗位，筛选标准为来源岗位可追溯、JD 至少 80 字且同时具备岗位职责和任职要求。接口与普通目录采用同一 `JobList` 响应及分页、专业、最低学历筛选；其中 `application_status=unverified` 的记录只用于测试，不能呈现为可投。

## 创建、轮询与重试

`POST /api/job-matches`：`{"resume_id":"原简历ID","job_ids":["岗位ID1","岗位ID2"]}`。返回 202 `{"task_id":"任务ID"}`。仅接受 ready/need_review 且非空简历；`not_resume` 返回 HTTP 422 / `CONTENT_MISMATCH`。岗位 ID 原始列表 1–50 项，重复合并。整批验证后创建任务，禁止额外字段。默认仅允许 open 岗位。联调测试可显式传 `"allow_unverified_for_testing":true` 匹配 JD 至少 80 字的 unverified 岗位；此选项只放宽匹配测试，不改变岗位状态，不代表可投，也不允许 closed 岗位。

`GET /api/job-matches/{task_id}` 返回 `{status,stage,progress,analysis_completed,analysis_total,analysis_started_at,error,error_code,items}`。建议每 1–2 秒轮询；基础分完成后 items 全量返回。`analysis_total` 是实际选入逐岗深度分析的岗位数，`analysis_completed` 只计其中 `succeeded` 或已结束的 `degraded`；未选中的 `not_selected`/`ai_disabled` 不计入。`analysis_started_at` 是开始逐岗分析的 UTC ISO 8601 时间，开始前为 null；前端可据此计算已等待时间。items 字段及可直接使用的示例见 `examples/job_matches.json`。结果分数降序、同分 job_id 升序；AI 后重新排序。progress 不表示预计剩余时间。

前 8 岗（MATCH_LLM_TOP_K 可降低，0 关闭）共享现有 AI 并发门限；单项预算 90 秒含并发等待，整批自开始处理起 165 秒含基础评分及向量处理，不含任务排队。这些预算不是 ETA。整批超时使任务为 `failed/JOB_MATCH_TIMEOUT`，未结束岗位标为 `batch_timeout`，保留已有逐岗结果；单项超时只使该岗位降级。真实 AI 成功后 score=round(0.35*stage1_score+0.65*report.overall_score)，否则保持基础分。命中/缺口与 subscores 解释规则分；report 解释 AI 诊断。

analysis_status：pending/running 表示尚未结束（degraded=true、degraded_reason=null）；succeeded 表示真实 AI 报告完成；degraded 表示已结束降级。degraded_reason：ai_disabled、not_selected、input_too_short、input_too_long、model_failed、item_timeout、batch_timeout、mock_report。降级没有 report，reason=null；不编造 AI 理由。任务级 succeeded 允许部分或全部降级。

同一 resume_id、简历内容、岗位集合与快照及评分/提示词版本、Embedding 配置的重复请求，复用 queued/running/succeeded 任务；任务失败或 Embedding 降级的任务允许重建。原简历 ID 纳入指纹，保证后续面试使用的仍是原 ID。成功后重复请求是结果重放，不保证再次调用模型；未完成模型调用按输入合并、成功 LLM 报告持久缓存。重启中断任务为 failed/TASK_INTERRUPTED，可重新 POST。仅支持单 worker。

## 诊断与面试

`GET /api/job-matches/{task_id}/items/{job_id}/context` 返回 `{resume_id,job_id,diagnose_request,interview_request}`。两个请求体可分别直接传给 POST /api/diagnose 和 POST /api/interviews；不要求已有 AI 排序报告。任务保存创建时原简历全文与 JD 快照，context 不重新读取目录 JD。

现有诊断仍要求简历/JD 各不少于 30 字且合计不超过 20000 字。context 原样返回，不截断；诊断超限由原接口返回 400 TEXT_TOO_SHORT / 413 TEXT_TOO_LONG，不阻止获取面试请求。面试创建前仍按原接口校验原 resume_id。简历 ID 不存在或已不可读时 context 返回对应 404/409，避免使用失效 ID。

## 错误

统一体：`{"error":{"code":"JOB_NOT_FOUND","message":"岗位不存在","request_id":"请求ID"}}`。

| HTTP | code | 场景 |
|---|---|---|
|400|INVALID_INPUT / TOO_MANY_JOBS|空 ID、空岗位列表 / 原始列表超过 50|
|404|RESUME_NOT_FOUND / JOB_NOT_FOUND / TASK_NOT_FOUND|简历、岗位、任务或任务中的岗位不存在；任务类型不符|
|409|RESUME_NOT_READY / RESUME_CHANGED / JOB_NOT_OPEN|简历解析失败或未完成 / 原简历内容变化需重建匹配 / 岗位非 open 且不满足显式测试条件|
|422|VALIDATION_ERROR|类型、额外字段、查询参数非法|

内部失败通过轮询返回 failed、JOB_MATCH_FAILED；基础评分尚未完成就耗尽整批预算时为 failed、JOB_MATCH_TIMEOUT；重启返回 failed、TASK_INTERRUPTED。错误不包含原文或模型内部异常。完整请求、排队、运行、成功、部分/全部降级、上下文与错误示例位于独立 JSON，示例数据均为虚构联调夹具，不能计入真实岗位数量。

2026-10-27 目录含 40 条满足多专业测试结构门槛的真实岗位，十类各 4 条，其中最低学历硕士/博士 12 条、本科 28 条；可投岗位仍只有 11 条。前端不得把测试池中的 unverified 记录显示为已核验可投。岗位状态以 `verified_at` 时点为准，到达截止日期后需要重新核验。具体来源和缺口见 `catalogue/VALIDATION.md`。
