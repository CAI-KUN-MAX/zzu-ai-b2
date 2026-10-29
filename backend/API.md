# 后端接口：简历解析与匹配排序

单份简历对多个岗位的新接口见 [JOB_MATCH_API.md](JOB_MATCH_API.md)，与原 `/api/match` 契约独立。岗位来源与数量验收见 [catalogue/VALIDATION.md](catalogue/VALIDATION.md)。单简历多岗位支持可选云端 Embedding；原 `/api/match` 不使用 Embedding，字符 2-gram 相似度不能称为语义向量匹配。

新接口的测试结果和环境限制见 [JOB_MATCH_VALIDATION.md](JOB_MATCH_VALIDATION.md)。

新增五轮模拟面试接口，见本文“模拟面试”章节；既有诊断和筛选契约保持不变。

当前版本仅修改 `backend/`，支持 PDF / DOCX / PNG / JPG 批量解析、离线 OCR、SQLite 持久化、进度轮询、全文读取、确定性匹配、AI 精排、结果缓存和 Excel 导出。原有 `POST /api/diagnose`、错误响应格式及文档开关保持原样。

OCR 依赖独立安装；没有 OCR 引擎或设置 `OCR_PROVIDER=stub` 时，图片和扫描件返回 `OCR_UNAVAILABLE`，文本 PDF / DOCX 与匹配功能仍可用。`stub` 不生成虚构识别文字。

## 启动与验证

使用 Python 3.11 或以上版本，在仓库根目录安装后端依赖：

```bash
python -m pip install -r backend/requirements.txt
python -m pip install -r backend/requirements-ocr.txt
cd backend
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

仅支持单 worker；异步任务在进程内运行，状态保存在 SQLite。不要让多个服务进程共用同一数据目录。可参考 `.env.example` 将新增变量合并到现有 `backend/.env`，保留原来的模型密钥配置。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATA_DIR` | `backend/data` | 相对路径始终基于仓库根目录；也支持绝对路径 |
| `MAX_UPLOAD_MB` | `15` | 单文件上限，支持 1–15MB，最大不超过 15MB |
| `OCR_MAX_PAGES` | `10` | PDF 页数上限 |
| `OCR_PROVIDER` | `auto` | `auto / rapidocr` 使用离线 RapidOCR；`stub` 明确关闭 OCR |
| `MATCH_LLM_TOP_K` | `8` | AI 分析前 K 份，上限 8；设 0 关闭 AI，仍可排序和导出 |
| `MATCH_CONCURRENCY` | `3` | 全局 AI 并发，上限 3 |
| `ENABLE_DOCS` | `false` | 沿用旧开关，生产环境关闭 |

数据目录包含 `app.db` 和 `uploads/`，已通过后端目录内的 `.gitignore` 排除。原文件按 SHA-256 保存，不使用用户文件名作为路径。已有数据库自动增加 `llm_cache` 表和简历 `low_conf` 列，无需清空数据。

测试（在 `backend/` 下）：

```bash
python -m pip install -r requirements-test.txt
# Linux/macOS
ENABLE_DOCS=false python -m unittest discover -s tests -v
# PowerShell
$env:ENABLE_DOCS='false'
python -m unittest discover -s tests -v
```

显式关闭测试进程中的文档开关，是因为现有本地 `.env` 可能启用文档；无需修改已有配置文件。测试使用临时目录，不写入实际简历库。

## 1. 上传

`POST /api/resumes/batch`，multipart 主字段名为 **`files`**，与当前前端一致；同时兼容旧字段 **`files[]`**。两种字段合计每批 1–20 份、单份最多 15MB。Swagger 中任选一个字段添加文件即可。

```bash
curl -X POST http://127.0.0.1:8000/api/resumes/batch \
  -F 'files=@resume.pdf' -F 'files=@resume.docx'
```

返回 **202**：

```json
{"task_id":"任务ID"}
```

按文件头与 DOCX 内部结构识别类型，忽略扩展名和客户端 MIME。整批完成数量、大小、空文件和格式校验后才创建任务；有一份不符合上传条件，整批拒绝，不留下部分入库记录。

同一 SHA-256 只保存一份，已成功解析的文件直接复用全文；并发重复上传不会重复提取。同批重复文件仅产生一个结果项。重复文件保留首次入库的文件名、简历 ID；解析失败的文件重新上传时允许重试。

## 2. 查询进度

`GET /api/tasks/{task_id}` 返回 **200**：

```json
{
  "status":"succeeded",
  "stage":"解析完成",
  "progress":100,
  "error":null,
  "error_code":null,
  "items":[{
    "resume_id":"简历ID",
    "name":"张三.docx",
    "chars":812,
    "status":"ready",
    "preview":"提取文本的前60字",
    "error":null
  }]
}
```

- 任务状态：`queued → running → succeeded | failed`。进度 0–100，运行中 stage 如 `解析 3/8`。建议每 1–2 秒轮询。
- 数据库内部简历状态：`parsing → ready | need_review | not_resume | failed`。对外 `items` 仅包含这四种已结束解析的项目，解析中的项目暂不返回；队列和处理进度通过整体 `status/stage/progress` 展示，初期 `items` 可以为空。提取后独立检查身份/联系方式、教育、经历、技能等简历特征，以及通知、合同、论文、招聘 JD、聊天记录和普通文章等反向特征。边界不确定、少于 30 字或 OCR 低置信内容标记 `need_review`；明确不符标记 `not_resume`。

- `need_review` 的项目错误码为 `CONTENT_REVIEW_REQUIRED`，仍兼容匹配、岗位匹配和面试流程；`not_resume` 的项目错误码为 `CONTENT_MISMATCH`，读取全文及上述三个创建入口均返回 HTTP 422，且不会创建可继续处理的任务。解析/OCR 错误继续使用 `OCR_FAILED`、`OCR_UNAVAILABLE`、`UNSUPPORTED_FILE` 或 `INGEST_FAILED`。
- 至少一份可读取时任务为 `succeeded`，仍需逐项检查 `status/error`；全部失败时任务为 `failed`，任务 error 为首份文件错误。
- 任务级别的 `error` 为中文字符串或 `null`，与前端 `useTask` 的直接渲染方式一致；额外字段 `error_code` 保留错误码，正常时为 `null`。单份项目的额外字段 `error` 仍保留 `{"code":"OCR_UNAVAILABLE","message":"中文提示"}` 对象，供排错使用。数据库仍保存原始错误对象，旧记录无需迁移。HTTP 级别错误沿用原有含 `request_id` 的外层错误体。
- 进程启动和正常退出都会将未完成任务、仍在解析的简历标记失败，提示“服务重启，任务已中断，请重试”；已经完成的文件保留。
- 同批最多并发解析两份，批次排队执行；OCR 模型延迟加载，文本 PDF/DOCX 不触发加载，不阻塞原有诊断接口的模型调用。项目额外返回 `low_conf`，表示低置信识别行数，大于 0 时标记 `need_review`。

## 3. 读取全文

`GET /api/resumes/{resume_id}/text` 返回 **200**：

```json
{"resume_id":"简历ID","name":"张三.docx","chars":812,"text":"全文"}
```

解析中返回 409；失败时返回对应错误，不以空字符串冒充成功。

## 提取规则与错误

PDF 按平均每页至少 80 字使用文本层；低于阈值时使用 PyMuPDF 200dpi 渲染并逐页离线 OCR。加密、损坏或超页数的 PDF 返回明确错误。PNG/JPG 统一解码为 PNG 后调用 OCR；单张图像或单页渲染不超过 2500 万像素。识别行置信度低于 0.7 时计入 `low_conf` 并提示人工核对。DOCX 按正文顺序读取段落及表格，表格每行以 ` | ` 分隔，解压总大小限制为 32MB。

清洗只移除纯页码、出现至少三次且不超过 20 字的短行，以及独立水印行；归一空白字符、压缩空行，不合并正文短行。

HTTP 错误体沿用：

```json
{"error":{"code":"INVALID_INPUT","message":"不能上传空文件","request_id":"请求ID"}}
```

| HTTP | code | 场景 |
|---|---|---|
| 400 | `INVALID_INPUT` | 空文件 |
| 400 | `TOO_MANY_RESUMES` | 单批超过 20 份 |
| 404 | `TASK_NOT_FOUND` / `RESUME_NOT_FOUND` | ID 不存在 |
| 409 | `RESUME_NOT_READY` | 全文仍在解析 |
| 413 | `FILE_TOO_LARGE` | 单文件超过上限 |
| 415 | `UNSUPPORTED_FILE` | 不支持、损坏、加密、PDF 超页数或 DOCX 解压过大 |
| 422 | `VALIDATION_ERROR` | `files` 和 `files[]` 均未提供，或请求格式错误 |
| 422 | `OCR_FAILED` | 提取清洗后没有文字 |
| 503 | `OCR_UNAVAILABLE` | OCR 关闭、缺少引擎或引擎初始化失败 |

`TASK_INTERRUPTED` 和 `INGEST_FAILED` 也会出现在任务/项目错误中，分别代表任务中断和意外解析失败。

## 4. 创建匹配任务

`POST /api/match`，JSON 请求，返回 **202** `{"task_id":"匹配任务ID"}`：

```json
{"jd_text":"不少于30字的岗位职责和任职要求全文", "resume_ids":["实际简历ID"]}
```

JD 去除首尾空白后为 30–20000 字；简历 ID 列表为 1–50 项，重复 ID 合并。不存在的 ID 返回 404 `RESUME_NOT_FOUND`；未解析完成或失败的简历返回 409 `RESUME_NOT_READY`；空文本返回 400 `INVALID_INPUT`；超过 50 项返回 400 `TOO_MANY_RESUMES`。整批校验通过后才创建任务。

基础评分复用旧诊断的关键词提取与边界匹配：技能关键词占 55%，字符 2-gram 余弦相似度占 30%，学历占 15%。关键词按分句出现频次取前 40 项，命中 15 项技能分满分；同分始终按简历 ID 排序。JD 无学历门槛给 100，简历未写学历给 60，达到要求给 100，差一档给 60，更低给 30。

只对基础分前 8 份调用现有 `diagnose()`，沿用原提示词及原文证据校验。AI 完成时最终分数为 `round(0.35 × 基础分 + 0.65 × report.overall_score)`。基础分保存在 `stage1_score`，`subscores` 解释基础分三个维度，`report.dimension_scores` 解释 AI 诊断四个维度。

单条调用上限 90 秒，整批 AI 分析预算 165 秒，全局并发最多 3。

诊断输出的原文引用校验只忽略空白差异（PDF 提取常在词中间断行，如 “Docke\nr”），文字和标点仍须逐字一致。第一次调用严格校验，不合格时带原因重试；重试那次开启采样，并对仍不合格的个别亮点或缺项直接删除（缺项的简历证据对不上时删除整条，不改成“未体现”），其余已核对内容照常返回，总结改为基于剩余条目生成。失败、超时、未选入前 8 或主动关闭 AI 时保留基础分、`degraded=true`、`reason=null`，不编造 AI 理由。整批预算耗尽会取消未完成 AI 调用并保存已有结果。简历少于 30 字或简历与 JD 总字数超过旧诊断的 20000 字限制时，该份自动降级，不截断原文、不影响其他简历。

缓存键含简历全文、JD 全文、提示词版本和原提示词，不落库原始 JD 请求字段；已验证报告可随任务结果保留 JD 引用片段。只有真实 `meta.mode=llm` 报告写入缓存，mock 不污染真实缓存。

## 5. 查询匹配结果

`GET /api/match/{task_id}`，返回 **200**：

```json
{
  "status":"succeeded", "stage":"匹配完成", "progress":100,
  "error":null, "error_code":null,
  "items":[{
    "resume_id":"实际简历ID", "name":"张三.docx",
    "score":70, "stage1_score":70, "level":"medium", "level_label":"较匹配",
    "subscores":[
      {"key":"skill_match","label":"技能关键词匹配","score":70,"weight":0.55},
      {"key":"text_similarity","label":"文本相似度","score":55,"weight":0.3},
      {"key":"education_match","label":"学历匹配","score":100,"weight":0.15}
    ],
    "matched":["Python","MySQL"], "missing":["Docker"],
    "reason":null, "degraded":true
  }]
}
```

数值仅用于说明字段，不代表固定评分。`status` 沿用 `queued/running/succeeded/failed`，`error` 为字符串或 null。基础评分完成后即返回完整候选列表，AI 阶段逐份更新，文案如 `深度分析 3/8`。非降级项包含与 `DiagnoseResponse` 完全一致的 `report`，`reason` 来自其中的模型摘要。降级项不返回 `report`，前端现有判空逻辑可直接处理。

`GET /api/tasks/{id}` 仅查询解析任务，`GET /api/match/{id}` 仅查询匹配任务；类型不符或不存在均返回 404。重启后未完成匹配任务按已有机制失败，错误仍为可直接显示的中文字符串。

## 6. 导出 Excel

`GET /api/match/{task_id}/export`，完成后返回 xlsx，包含排名、简历名称、分数、等级、命中/缺失关键词、AI 理由、AI 分析完成标识。使用 UTF-8 中文下载名；文件名和用户文字按字面文本写入单元格，不执行 Excel 公式。任务尚未完成或已失败返回 409 `TASK_NOT_READY`。导出可用于纯确定性排序，不依赖模型密钥。

## 验收与上线边界

1. 上传 20 份电子版简历，轮询直到完成，使用返回的 ID 读取全文。
2. 重复上传同一文件，验证 ID 相同且不重复提取。
3. 混合上传有效 DOCX、文本 PDF、扫描 PDF、PNG/JPG，验证全部出文本；OCR 关闭时验证中文错误提示。
4. 验证空文件、伪造扩展名、超大文件、加密 PDF、空白 DOCX 不会留下永远解析中的记录。
5. 运行全部后端测试，确认旧诊断接口回归测试通过。
6. 创建匹配任务、轮询排序结果、展开 AI 报告，再导出 20 条结果。
7. 关闭 AI 验证全降级排序；开启 AI 验证单条失败降级；重复匹配验证缓存。

额外验证命令。单元测试必须在 `backend/` 下运行，从仓库根目录直接 `discover -s backend/tests` 会找不到 `app` 包；两个脚本在仓库根目录执行：

```powershell
$env:ENABLE_DOCS='false'
$env:TEST_REAL_OCR='1'
cd backend; ..\.venv\Scripts\python.exe -m unittest discover -s tests -v; cd ..
# 使用临时数据库和虚构的 20 份混合文件，不调用模型
.venv\Scripts\python.exe backend/scripts/smoke_screening.py
# 同样的 20 份文件，对前 1 份调用真实模型并验证重复匹配缓存
.venv\Scripts\python.exe backend/scripts/smoke_screening.py --live-llm
```

`--live-llm` 读取现有 `backend/.env` 模型配置，只发送脚本内虚构材料；测试目录结束后自动清理。默认 AI 前 8 份的数量限制及最多 3 并发通过自动测试验证。

中文真实 OCR 测试会依次查找微软雅黑、macOS 黑体/苹方、Noto CJK、文泉驿等字体，任一存在即运行；Linux 服务器可安装 `fonts-noto-cjk` 或 `wqy-microhei`。

浏览器联调用的虚构文件可用 `python backend/scripts/make_acceptance_files.py <输出目录>` 生成：20 份混合简历（DOCX 6、文本 PDF 6、扫描 PDF 3、PNG 3、JPG 2）及重复、空文件、超大、伪造扩展名、加密/损坏 PDF、空白图片、低置信度图片、空白 DOCX 等异常文件。

## 前端与部署对接（联调分支）

- 本地前端联调时 `VITE_API_BASE` 留空，走 Vite 的 `/api` 代理到本机后端；填公网地址就测不到本地变更。诊断超时默认 80 秒，大于后端 75 秒。
- 前端按每批最多 5 份、50MB 拆批上传，每批一个解析任务，页面合并轮询多个任务并按 `resume_id` 去重。某一批因伪造扩展名、损坏等原因被整批拒绝（4xx）时，前端会把这批拆成单个文件重传，只有问题文件失败。空文件和超过 15MB 的文件在前端直接拦截。
- 单份项目失败时，前端直接展示 `items[].error.message`，不再请求全文；`GET /api/resumes/{id}/text` 返回 503 `OCR_UNAVAILABLE` 时显示后端原提示。
- 匹配结果页把“基础评分”三个分项（`subscores`）与“AI 诊断”四个维度（`report.dimension_scores`）分开展示，并给出 `score = round(0.35 × stage1_score + 0.65 × report.overall_score)` 的计算说明；`degraded=true` 时只展示基础评分和降级原因说明。
- Nginx 已按接口区分请求体上限与限流（上传 60MB；高成本接口每分钟 10 次；轮询每分钟 240 次），见 `deploy/nginx.conf` 与 `deploy/README.md`。
- 匹配评分改动：OCR 把英文技能连写（如 `PythonFastAPIMySQL`）时也能命中关键词；关键词列表去掉“岗位职责”“使用”“本科”等非技能词和超过 6 字的中文长句。
- 当前接口沿用已有无鉴权访问方式，不应向公网提供真实简历库，接入真实数据前需另行实现访问控制。

## 模拟面试

新增接口与前端 `feature/interview` 的请求/响应类型一致；该前端分支不在本次后端分支中修改或合并。没有历史列表、会话恢复查询或面试导出接口。

### 创建会话

`POST /api/interviews` 返回 **201**。请求：

```json
{"resume_id":"已解析简历ID","jd_text":"至少30字的完整岗位要求"}
```

响应：

```json
{
  "interview_id":"服务器生成的会话ID",
  "status":"active","round":1,"max_rounds":5,
  "question":{"id":"服务器生成的问题ID","text":"一道岗位与项目相关的问题","focus":"考察点","source":"llm"}
}
```

支持 `ready / need_review` 且全文非空的简历，不要求该简历已获得匹配报告。JD 去除首尾空白后为 30–20000 字。会话保存创建时的简历和 JD 快照，后续不依赖原简历行的内容变化。

### 提交本轮回答

`POST /api/interviews/{interview_id}/answers` 返回 **200**。请求：

```json
{"question_id":"当前问题ID","answer_text":"至少20字的本轮回答"}
```

第一至四轮响应：

```json
{
  "interview_id":"会话ID","status":"active","round":1,"max_rounds":5,
  "feedback":{
    "strengths":["回答实际体现的优点"],
    "improvements":["可执行的改进建议"],
    "reference_points":["建议覆盖的知识点，不代表候选人已经做过"]
  },
  "next_question":{"id":"下一问题ID","text":"结合本轮回答的追问","focus":"考察点","source":"llm"}
}
```

第五轮响应为 `status="completed"`、`round=5`、`next_question=null`。创建响应的 round 是当前题号，回答响应的 round 是刚完成的轮次。回答去除首尾空白后为 20–3000 字。客户端不能传入轮次、问题正文或会话状态；未约定字段会返回 422。

题目的 `source` 为 `llm`（模型生成并通过校验）、`fallback`（服务端模板兜底）或 `unknown`（旧记录没有来源信息）。回答响应的反馈仍来自模型并经过校验；`next_question.source` 只描述下一题，不代表反馈来源。旧会话重放时缺失来源按 `unknown` 返回，不推断为真实模型题。

### 状态、失败与重试

- 相同会话、问题 ID 和去除首尾空白后的相同回答，返回已保存的完整响应，不重复调用模型或推进轮次。即使面试已完成，也允许重放已回答问题的原响应。
- 已回答问题改换答案、问题属于其他会话、乱序提交、完成后提交新问题，返回 409。一个会话同时只允许一个回答生成请求，其他并发提交返回 409。
- 失败、超时、请求取消或服务中断不写入未完成回答，也不推进轮次；重试仍提交原 question_id。持久化提交之后响应丢失，可通过同题同答重放恢复。
- 会话有效期为创建成功后 24 小时；过期包括重放请求均返回 410。数据库不会自动物理删除会话，本版没有“24小时自动删除”的承诺。
- 每次生成连同共享并发队列等待、网络请求与一次结构修复，共用 75 秒预算。第一次调用关闭采样（`do_sample=false`）保证结果稳定；结构修复那次开启采样（temperature 0.7），否则同一输入每次得到同一份不合格输出，用户重试永远失败。
- 回答轮次中，如果反馈已通过校验、只有追问两次都不合格（未引用本轮回答、转到无关话题、重复已问问题等），服务端用本轮回答的原文片段按模板生成追问（focus 为“围绕本轮回答追问”，设想类回答用“你会如何”语气），轮次照常推进，结果同样持久化、可重放。反馈本身不合格时仍返回 502，不推进。
- 追问不能绕回旧话题：追问里与本轮回答对上的原文片段如果在前几轮回答里都出现过（本轮回答确有新内容时），视为绕回已讨论的话题，要求模型重写；兜底追问也优先选本轮新内容。
- 优点逐句核对：strengths 按逗号及作连接词的“并”“同时”等拆成小句（不切“并发”“并行”“同时在线”等词），回答原文中找不到任何连续 4 字依据的小句（常是从题目或简历混进来的内容）删除，整条都没有依据则删除该条。
- 否定回答：回答按小句（含“但/不过/而是”）拆分，含“没有使用、没做过、尚未实现、不熟悉”等否认自身经历的小句单独标出；优点小句只有在肯定小句里有依据、且与否定小句没有连续 4 字重合时才保留，宁可少写也不把用户否认的经验写成优点。“并发下也不会出现重复”这类结果描述不算否认。
- 处理后的反馈按对外 `Feedback` 结构（每项不超过 600 字、每组最多 5 项）再校验一次；补句号会超长时不补。不合格时交给修复重试，不会在组装响应时报 500。
- 创建会话两次都没生成合格题目时（例如 JD 中的注入指令让模型输出了录用概率），用简历原文中项目或技术相关的片段生成第一题（focus 为“简历项目深挖”），不再整体返回 502；模型的异常输出不会返回给前端。面试与匹配共用同一个最多 3 并发的信号量；旧文本诊断端点行为不变，不新增限流逻辑。
- 服务端保留完整原文，同时提供确定性的原文片段选项，由模型选择内部引用编号。第一题须引用简历或 JD；追问须引用本轮回答，并与选中的回答片段有至少四个连续字符的关联（忽略英文大小写），减少突然转到无关技能的话题。无法绑定本轮回答的优点直接剔除，允许 strengths 为空，不为保留优点编造证据。对以“我会/计划”等描述的回答，额外移除常见已完成成果措辞，并将追问中的“你是如何/你使用的”调整为计划语气。第五轮由服务端强制结束，丢弃模型额外生成的下一题。这些内部校验和有限措辞规则不改变前端公开类型，也不能替代人工审核模型语义与内容质量。
- 面试始终调用真实模型；`MOCK_MODE=true` 不会为面试生成虚构反馈。自动测试通过替换模型客户端验证异常分支，前端本地 mock 独立控制。
- 格式示例中的占位优点和建议会被过滤，空的参考要点会要求模型修复；仅元数据 focus 缺少有效描述时使用“岗位相关提问”标签，不编造问题或反馈。
- 不截断简历、JD 或历史回答。含系统提示、问题和回答历史的生成上下文总量超过 20000 字符时返回 413，请精简材料后新建会话。参考答案是回答方向，不是候选人事实，也不是评分或录用概率。

错误体保持 `{"error":{"code":"...","message":"中文提示","request_id":"..."}}`：

| HTTP | code | 场景 |
|---|---|---|
| 400 | INVALID_INPUT | 空文本或低于字数下限 |
| 404 | RESUME_NOT_FOUND / INTERVIEW_NOT_FOUND | 简历或会话不存在 |
| 409 | RESUME_NOT_READY / INTERVIEW_CONFLICT | 简历不可用、问题冲突或正在处理 |
| 410 | INTERVIEW_EXPIRED | 会话超过 24 小时 |
| 413 | TEXT_TOO_LONG | 字段或完整上下文超过限制 |
| 422 | VALIDATION_ERROR | 请求字段类型、结构错误或多传字段 |
| 502 | INTERVIEW_GENERATION_FAILED | 两次输出仍未通过校验 |
| 503 | LLM_UNAVAILABLE | 未配置模型或模型服务不可用 |
| 504 | LLM_TIMEOUT | 生成或并发排队超时 |
| 500 | INTERVIEW_FAILED | 意外内部故障，不向客户端泄露原始异常 |

### 数据库与环境

启动时自动 `CREATE TABLE IF NOT EXISTS interviews`，只新增这一张表，不修改既有 resumes、tasks、llm_cache 内容。保存会话 ID、简历 ID、简历/JD 快照、轮次状态及已完成问答响应、创建和过期时间。无需清空现有数据库。

继续要求单 worker，不能让多个进程共用同一数据库并同时服务面试请求。进程内的忙碌标记在请求结束时释放，重启后自然清空；持久化会话不保存永久“处理中”标记。重启不会清空完成的问答。复用原有 `LLM_API_KEY` 和服务地址；可选 `INTERVIEW_MODEL` 独立指定面试模型，默认 `glm-4-flash`，不改变原诊断或匹配模型。无新增必填环境变量；每次生成 75 秒预算、五轮、24 小时为本版固定产品参数。五轮比原版多两次回答生成调用，整场耗时不固定。

### 本地验证与联调样本

虚构材料和五轮回答见 `backend/examples/interview_request.json`。本地服务启动后，先通过上传接口取得真实 resume_id，再依次调用创建和回答接口；问题 ID 必须从上一次响应复制，不能使用样例占位 ID。

在仓库根目录运行真实模型验证：

```powershell
.venv\Scripts\python.exe backend/scripts/smoke_interviews.py --output interview-result.json
```

脚本使用临时数据库，依次上传虚构简历、创建面试、完成五轮，并验证同题同答重放、服务对象重建后持久化、结束后拒绝继续答题。会调用现有模型服务，记录的输出仅含虚构内容，不修改线上服务或实际简历库。结果用于人工检查题目是否贴合岗位、追问是否关联回答、反馈是否把设想当作实际成果。

### 合并后部署注意

Nginx 的 `/api/` 兜底规则是查询请求限流和 60 秒超时，不能承接最长 75 秒的面试生成。以下规则已写入仓库 `deploy/nginx.conf`（沿用 llm_limit 区域，正则 location 优先于 `/api/` 前缀规则），发布时覆盖服务器配置并先执行 `nginx -t`：

```nginx
location ~ ^/api/interviews(?:/[^/]+/answers)?$ {
    limit_req zone=llm_limit burst=3 nodelay;
    client_max_body_size 256k;
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 85s;
}
```

前端面试请求超时应为 90 秒，先完成真实浏览器五轮联调，再决定发布。现有线上版本不包含这两个新接口。
