# 单简历多岗位契约（v1）

本接口与 `/api/match`（一个 JD、多份简历）独立。未计意向加分的规则分为技能关键词 55% + 字符 2-gram 余弦相似度 30% + 学历规则 15%。多岗位匹配可使用智谱 Embedding-3 辅助排序；字符相似度本身不是语义向量。学历分以岗位结构化 `education` 为准。分数用于相对排序，不是录用概率或资格审查。

岗位规则评分排除“原型、文档、流程、测试、验证”等单独出现的泛词；具体复合技能仍可参与评分。泛词过滤不能补全缺失的 JD，也不能保证识别求职意向。规则关键词识别包含有限的跨专业术语及明确同义写法（如用户访谈与用户访谈研究、PCR 与聚合酶链式反应）；对“没有 PCR 经验”“不熟悉 Python”等紧邻关键词的简单否定作有限排除。复杂否定、字符相似度及其他语境仍可能误判；文本命中不代表熟练程度、资格或真实经历，词表也不覆盖所有专业，结果需结合原文人工核对。

## Embedding 排序

`JOB_EMBEDDING_ENABLED=true` 启用（默认关闭），从 `ZHIPUAI_API_KEY` 读取智谱密钥，使用 `embedding-3`、1024 维，将简历和岗位文本发送至智谱，产生向量接口费用。配置迁移时需单独设置该变量；原 `LLM_API_KEY` 仍供诊断和面试使用。文本按最多 512 字分块、无截断；超过 256 块整批回退。向量按块长加权平均后计算余弦，用同批岗位的语义名次计算百分位（单岗位为 50），`stage1_score=round(0.8*规则分+0.2*语义名次百分位)`；并列相似度使用相同平均名次。该值依赖同批岗位，不能与不同批次或规则评分直接比较，不是录用概率。技能命中、缺口与原有子分数仍解释规则分；学历等硬条件仍应人工核对。Embedding 成功后才按新基础分选择 AI 深度分析岗位。

任务增加 `embedding_status`：`disabled`、`pending`、`succeeded`、`degraded`、`unknown`（旧任务）；`embedding_error` 为 `null` 或 `unavailable`、`timeout`、`input_too_large`、`rate_limited`、`authentication_failed`、`insufficient_balance`、`invalid_vector`。智谱业务错误码 1113 表示欠费，不能把所有 HTTP 429 都当作普通限流；其他无法明确判断的 429 保留 `rate_limited`。每项增加 `rule_score`（规则基础分）及 `embedding_similarity`（原始余弦，-1 至 1；不可用为 null）。服务不可用、限流、超时、输入过长或返回无效向量时整批回退规则分，不混用不同口径；失败任务再次 POST 可重新尝试。只在进程内处理向量，不写入数据库或日志。预算 30 秒，使用共享模型并发门限。旧 `/api/match` 不变。

向量字段的独立虚构示例见 `examples/job_embedding.json`。

## 岗位目录

`GET /api/jobs?category=计算机&education=本科&application_status=open&page=1&page_size=20`

参数均可选；不传 `application_status` 时返回 open 和满足测试池完整性门槛的 unverified 岗位，排除 closed；显式传入状态时按状态精确筛选。page=1、page_size=20（1–100）。education 按岗位最低学历精确筛选，不表示个人资格判定。category 为十个专业大类，详见 OpenAPI。返回 `{catalogue_version,total,page,page_size,items}`；items 为完整岗位，包含 job_id、title、company、cities、category、education、education_requirement、majors、graduation_year、jd_text、source_url、published_at（YYYY-MM-DD）、publication_type（original/repost）、application_url（未核实入口时为 null）、verified_at、application_status（open/closed/unverified）、verification_note。原始状态和 verified_at 不代表独立状态核验；展示使用有效状态。

按用户确认，`open` 岗位必须有 `source_url`（岗位 JD 来源地址），但不强制提供单独的 `application_url`；未知投递入口保持 null，来源地址不自动视为投递入口。用户确认的状态是用户提供的信息，不代表系统独立验证或保证实际投递成功。目录验收中的 JD 完整性检查保持不变。

`GET /api/jobs/{job_id}` 返回单条完整岗位；不存在为 404 JOB_NOT_FOUND。国家平台明确显示更新时间、但未给出首次发布日期时，按照用户授权将更新时间填入日期字段并在核验备注说明。`application_status=unverified` 可显式查看真实来源的候选岗位，其中部分历史记录仍只有摘要，不计入测试就绪集。待核验岗位没有明确投递入口时 `application_url=null`，不能把 `source_url` 当作投递地址；前端显示有效状态，缺少证据时显示招聘状态待核实。

`GET /api/jobs/testing-pool?category=生物医药&page=1&page_size=20` 返回满足完整性门槛的岗位，筛选标准为 JD 至少 80 字且同时具备岗位职责和任职要求。接口与普通目录采用同一 `JobList` 响应及分页、专业、最低学历筛选；`unverified` 不代表已确认可投。

## 创建、轮询与重试

`POST /api/job-recommendations` 接受 `{"resume_id":"原简历ID","category":null,"city":null}`，意向字段可省略；提供时按专业大类、城市精确筛选。对当前目录中 open 和满足完整性门槛的 unverified 岗位执行规则初排。简历中明确标注“求职意向”等字段时，有限规则识别用户体验、后端、前端、数据分析、产品经理和软件测试方向；岗位名称有对应线索时，基础分加 20 分（上限 100），字段 `intent_bonus` 表示实际加分。不再因 JD 中偶然提及用户体验而给其他岗位加分；岗位名称未直接体现方向时可能漏加分。规则不排除未命中岗位，可减轻漏召回；支持部分英文用户体验同义词、无冒号但以空格分隔的意向字段及常见否定词；其他意向、复杂否定和文本格式可能无法识别。意向线索不证明能力或岗位适合。然后最多取前 30 项作为候选，再复用岗位匹配任务，返回 202 `{"task_id":"任务ID"}`；通过原轮询和 context 接口获取结果。启用 Embedding 时在候选范围内重排，之后最多对前 8 岗进行 AI 分析；新推荐任务在深度分析前确定最多 8 项展示名单，后续只对名单内岗位重新排序。进度只统计入选深度分析的岗位。历史任务继续按原规则读取。初排 30 名以外仍可能遗漏相关岗位；Embedding 未启用或失败时仍按规则初排。无符合条件岗位返回 404 `NO_RECOMMENDABLE_JOBS`。少于 8 个时如实返回实际数量；未核验岗位不能表述为确认可投。规则分是排序参考，并非录用概率。

`POST /api/job-matches`：`{"resume_id":"原简历ID","job_ids":["岗位ID1","岗位ID2"]}`。返回 202 `{"task_id":"任务ID"}`。仅接受 ready/need_review 且非空简历；`not_resume` 返回 HTTP 422 / `CONTENT_MISMATCH`。岗位 ID 原始列表 1–50 项，重复合并。整批验证后创建任务，禁止额外字段。允许 open 和满足测试池完整性门槛的 unverified 岗位；不允许 closed 岗位。兼容保留 `allow_unverified_for_testing` 字段，已不影响上述规则。匹配不改变岗位状态，也不代表当前可投。

`GET /api/job-matches/{task_id}` 返回 `{status,stage,progress,analysis_completed,analysis_total,analysis_started_at,error,error_code,items}`。建议每 1–2 秒轮询；基础分完成后 items 全量返回。`analysis_total` 是实际选入逐岗深度分析的岗位数，`analysis_completed` 只计其中 `succeeded` 或已结束的 `degraded`；未选中的 `not_selected`/`ai_disabled` 不计入。`analysis_started_at` 是开始逐岗分析的 UTC ISO 8601 时间，开始前为 null；前端可据此计算已等待时间。items 字段及可直接使用的示例见 `examples/job_matches.json`。结果分数降序、同分 job_id 升序；AI 后重新排序。progress 不表示预计剩余时间。

前 8 岗（MATCH_LLM_TOP_K 可降低，0 关闭）共享现有 AI 并发门限；单项预算 90 秒含并发等待，整批自开始处理起 165 秒含基础评分及向量处理，不含任务排队。这些预算不是 ETA。整批超时使任务为 `failed/JOB_MATCH_TIMEOUT`，未结束岗位标为 `batch_timeout`，保留已有逐岗结果；单项超时只使该岗位降级。真实 AI 成功后 score=round(0.35*stage1_score+0.65*report.overall_score)，否则保持基础分。命中/缺口与 subscores 解释规则分；report 解释 AI 诊断。

每个岗位增加 `skill_assessments`，包含 `skill_name`、`requirement`（是否在 JD 中识别到该技能）、`jd_evidence`（JD 原文片段）、`resume_evidence`（简历原文片段数组）、`demonstrated_evidence`（被识别为实践描述的原文，其余为 null）、`evidence_status` 和 `assessment`。状态为 `demonstrated`（识别到实践描述）、`mentioned_only`（仅提及）、`not_found`（提取文本未找到）、`uncertain`（语境不清或否定）。识别基于有限术语和上下文规则，并非穷举；未找到只表示已提取文本中未识别到，不证明不会。已提取文本可能受 OCR 或排版影响，建议核对原文件。成功报告中涉及已识别技能的亮点和缺口按同一证据重新生成，不改变评分公式；未识别技能仍需人工核对。`matched` / `missing` 仍是规则评分关键词，与实践证据状态不同。字段对旧任务默认为空数组。

技能证据独立示例见 `examples/job_skill_evidence.json`。

为避免把可选条件误当作必需缺口，简单的“不要求”、加分项及包含“或”的要求不会生成对应技能判断；识别不到或表述复杂时也可能漏项。非技能反馈会保留，不能保证识别同义词或所有隐含矛盾。

analysis_status：pending/running 表示尚未结束（degraded=true、degraded_reason=null）；succeeded 表示真实 AI 报告完成；degraded 表示已结束降级。degraded_reason：ai_disabled、not_selected、input_too_short、input_too_long、model_failed、item_timeout、batch_timeout、mock_report。模型结果与已识别实践证据直接冲突且无法安全保留时归入 model_failed，以兼容现有前端。降级没有 report，reason=null；不编造 AI 理由。任务级 succeeded 允许部分或全部降级。

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
|409|RESUME_NOT_READY / RESUME_CHANGED / JOB_NOT_OPEN|简历解析失败或未完成 / 原简历内容变化需重建匹配 / 岗位关闭或未核验且不满足完整性门槛|
|422|VALIDATION_ERROR|类型、额外字段、查询参数非法|

内部失败通过轮询返回 failed、JOB_MATCH_FAILED；基础评分尚未完成就耗尽整批预算时为 failed、JOB_MATCH_TIMEOUT；重启返回 failed、TASK_INTERRUPTED。错误不包含原文或模型内部异常。完整请求、排队、运行、成功、部分/全部降级、上下文与错误示例位于独立 JSON，示例数据均为虚构联调夹具，不能计入真实岗位数量。

2026-10-27 目录含 40 条满足多专业测试结构门槛的真实岗位，十类各 4 条，其中最低学历硕士/博士 12 条、本科 28 条；可投岗位仍只有 11 条。前端不得把测试池中的 unverified 记录显示为已核验可投。历史 `verified_at` 并不证明状态核验，须按独立证据判断。具体来源和缺口见 `catalogue/VALIDATION.md`。

## 岗位证据兼容扩展（2026-11-11）

目录原始 `application_status`、`verified_at` 和 `verification_note` 保持不变，不再将其视为当前可投的充分证据。岗位响应新增 `effective_status`（open/closed/unverified）、`jd_completeness`（full/summary/campaign/unknown）和 `application_verified`（布尔）。历史记录缺少独立证据时有效状态为 unverified、正文完整度为 unknown、投递入口未核验；原始 closed 仍排除。字段缺失的旧客户端或旧任务应保守处理。投递 URL 本身不是入口证据。摘要或未知内容仅做基于现有文本的基础匹配，简章不做单岗分析；仅 full 且有独立证据的岗位可使用深度分析。证据快照及评分版本影响任务复用。证据文件 `catalogue/job-evidence.v1.json` 以 job_id 为键，每项可包含 status、content、application 证据，均需 HTTPS 来源、带时区的 checked_at 和 valid_until（前者必须早于后者）、非空 note；status 含 open/closed，content 含 full/summary/campaign 和 JD 文本 UTF-8 SHA-256，application 含精确 application_url。只有当前时间在有效期内且正文哈希或入口 URL 完全一致时相应证据生效；仅当前状态为 open 且入口证据有效才暴露可投标记。无证据默认为待核实，原始 closed 保守关闭。证据文件按读取刷新。旧 API 中 application_status 筛选仍按原始值；默认列表和推荐按有效状态及可分析文本筛选。旧任务深度报告在证据或 JD 不匹配时隐藏，基础分保留。
