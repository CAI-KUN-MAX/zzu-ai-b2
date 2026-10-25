# 后端接口：简历解析与匹配排序

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
- 数据库内部简历状态：`parsing → ready | need_review | failed`。对外 `items` 仅包含 `ready / need_review / failed` 三种已结束解析的项目，解析中的项目暂不返回；队列和处理进度通过整体 `status/stage/progress` 展示，初期 `items` 可以为空。少于 30 字但非空时标记 `need_review`，全文仍可读取。
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

单条调用上限 90 秒，整批 AI 分析预算 165 秒，全局并发最多 3。失败、超时、未选入前 8 或主动关闭 AI 时保留基础分、`degraded=true`、`reason=null`，不编造 AI 理由。整批预算耗尽会取消未完成 AI 调用并保存已有结果。简历少于 30 字或简历与 JD 总字数超过旧诊断的 20000 字限制时，该份自动降级，不截断原文、不影响其他简历。

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
