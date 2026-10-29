# 后端联调结果与比赛能力差距（2026-10-29）

后续更新：已加入可选智谱 Embedding 排序，默认关闭；真实接口调用返回 429，真实向量成功及效果评测仍待完成。具体字段与回退见 [岗位匹配契约](JOB_MATCH_API.md)。下文中的“尚无向量”属于接入前的验收记录。

## 验证范围与阻断

本次在当前 dev 工作区执行后端 unittest（`ENABLE_DOCS=false`、`TEST_REAL_OCR=1`）：115 项通过；compileall 通过。测试通过不代表前后端实际联调或真实模型验收完成。受限环境中真实模型诊断使用虚构简历和 JD、关闭 mock 调用，结果为 HTTP 500 `INTERNAL_ERROR`，服务日志记录 `APIConnectionError`。前端人员及其运行环境未参与本次测试，实际页面联调待完成。

后续在允许网络访问的执行环境重试：相同虚构数据的诊断返回 HTTP 200、`meta.mode=llm`，为真实模型生成；隔离数据目录中 DOCX 上传和解析成功，真实面试创建则返回 503 `LLM_UNAVAILABLE`，日志为 `APIConnectionError`，未进入第一轮。两次连接表现不同，尚不能确定面试失败根因；不应将受限环境的失败归因于业务实现。真实五轮及真实超时尚未验证，受控测试的超时和失败不等于真实模型验证。

自动化测试覆盖 DOCX、文本 PDF 上传及读取；真实离线 RapidOCR 覆盖中文图片、PNG/JPG 和扫描 PDF。低置信、OCR 不可用、非简历等错误由受控测试覆盖，并非真实低质量扫描件的识别准确率验收。上传至多岗位匹配、context、诊断、五轮面试的后端接口链路通过受控测试，其中诊断使用 mock，面试模型使用替身；这些输出均不是本次真实模型生成。未发现需要修改的已复现代码阻断，但真实模型连接阻断仍待排查。

目录检查 `--as-of 2026-10-29 --require-target`：80 条，结构通过；标记 open 41，测试池 43，目标检查通过。这是目录记录和规则检查，不等于当天逐条重新核验来源及投递状态。契约中的历史数量快照已过时，请以接口返回和核验时间为准。

## 前端联调交接

2026-10-29 静态对照发现前端阻断：`frontend/src/types.ts` 的 `ResumeStatus` 缺少 `not_resume`；`JobMatchPage.tsx` 通过 `status !== "failed"` 判断可匹配，会把该状态误当成可继续，随后后端正确返回 422 `CONTENT_MISMATCH`。`ScreenPage.tsx` 的状态样式映射也没有此项。前端应增加该状态及明确提示，仅允许 `ready` 和 `need_review` 进入匹配，并检查相关状态映射及持久化；本次后端范围未修改前端，尚需页面联调确认。另：`api/http.ts` 将 `INTERNAL_ERROR` 的 500 显示为“AI 正在思考中”，不能准确表达失败，可交由前端调整为失败与重试提示。

接口完整字段以 [岗位匹配接口契约](JOB_MATCH_API.md) 和 [后端接口](API.md) 为准。上传 `POST /api/resumes/batch` 使用 multipart `files`，轮询 `/api/tasks/{task_id}`；逐项检查状态：`ready` 可用，`need_review` 提示人工核对且允许继续，`not_resume` 不可继续，`failed` 展示项目错误。低置信行数 `low_conf` 大于零需要核对。OCR 关闭或不可用为 `OCR_UNAVAILABLE`；无文字为 `OCR_FAILED`。异步解析错误可能位于任务或项目中，不应只检查 HTTP 状态。

目录默认仅返回 open；测试池中的 unverified 岗位必须明确标记未核实，不能显示可投。创建 `POST /api/job-matches` 使用原 `resume_id` 和 `job_ids`；测试未核实岗位需显式 `allow_unverified_for_testing=true`。轮询时同时检查任务 `status/error_code` 与每项 `analysis_status/degraded_reason`：任务 succeeded 仍可能全部降级；仅 `succeeded` 项有真实 AI 报告，`mock_report`、`model_failed`、`item_timeout` 等不是成功报告。通过匹配项 context 获取诊断及面试请求，保留原简历 ID 和岗位快照。

典型 HTTP 错误：404 `RESUME_NOT_FOUND` / `JOB_NOT_FOUND` / `TASK_NOT_FOUND`；409 `RESUME_NOT_READY` / `RESUME_CHANGED` / `JOB_NOT_OPEN`；422 `CONTENT_MISMATCH` / `VALIDATION_ERROR`。诊断文本不足或超限分别为 400 `TEXT_TOO_SHORT`、413 `TEXT_TOO_LONG`。面试模型不可用 503 `LLM_UNAVAILABLE`、超时 504 `LLM_TIMEOUT`、生成失败 502 `INTERVIEW_GENERATION_FAILED`；失败的回答不推进轮次，应保留当前题目供重试。实际模型连接错误本次诊断返回 500 `INTERNAL_ERROR`，前端应展示通用重试提示并保留 request_id 供排查，不展示内部异常。详尽错误和示例见契约。

## 赛题差距与决策

用户提供的《任务.png》B2 行写明“LLM＋语义匹配（Embedding）＋OCR”及“就业材料 AI 核验（OCR＋真伪）”。因此两项是赛题描述中明确列出的能力；截图未包含评审规则，无法判断分值、验收细节或一票否决。需补充完整官方赛题和评分细则。

| 能力 | 当前覆盖 | 差距与建议 |
| --- | --- | --- |
| Embedding | 关键词 55%、字符 2-gram 30%、学历规则 15%，可选 LLM 诊断精排 | 尚无文本向量、向量召回或语义相似度。先确定服务或本地模型、中文效果、成本、数据传输及部署资源；用经标注的简历/JD 数据集与现有排序做对照，评估召回、排序质量和延迟；再设计向量版本、缓存、失败回退与证据展示。不要把余弦值直接解释为录用概率。生产依赖或版本变化须先说明成本并获得确认。 |
| 材料真伪 | OCR 提取、低置信提示、简历类型判断及模型输出与原文的引用校验 | 这些不能证明学历、证书、项目或文件真实。先定义材料范围、授权和可信数据来源；设计人工复核工作流，展示来源、核验时间和可追溯证据，使用已核验、存疑、无法核验等状态；接入有权限的发证方或权威查询渠道后，按渠道规则实施，并用已授权样本验证。无权威来源时只能标记待核验，不能断言真伪。 |

下一步：在允许访问模型服务的环境排查网络、供应商配置及密钥权限，使用虚构数据重跑诊断与五轮面试，记录真实成功、可控超时和失败行为；与前端按以上字段逐项实测。补齐评分细则和核验数据源后再决定两项功能范围与依赖。
