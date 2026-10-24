# 后端 V1：简历批量入库

本次是第一个可独立验收的小版本，仅修改 `backend/`。完成电子版 PDF / DOCX 的批量上传、文本提取、SQLite 持久化、进度轮询与全文读取。原有 `POST /api/diagnose`、错误响应格式及文档开关保持原样。

本次不包含真实 OCR、匹配排序、LLM 精排、缓存或 Excel 导出。PNG/JPG 与扫描 PDF 可以进入任务，但会返回中文 `OCR_UNAVAILABLE`，不会生成假识别结果。

## 启动与验证

在仓库根目录安装后端依赖：

```bash
python -m pip install -r backend/requirements.txt
cd backend
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

仅支持单 worker；异步任务在进程内运行，状态保存在 SQLite。不要让多个服务进程共用同一数据目录。可参考 `.env.example` 将新增变量合并到现有 `backend/.env`，保留原来的模型密钥配置。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATA_DIR` | `backend/data` | 相对路径始终基于仓库根目录；也支持绝对路径 |
| `MAX_UPLOAD_MB` | `15` | 单文件上限，支持 1–15MB，最大不超过 15MB |
| `OCR_MAX_PAGES` | `10` | PDF 页数上限 |
| `ENABLE_DOCS` | `false` | 沿用旧开关，生产环境关闭 |

数据目录包含 `app.db` 和 `uploads/`，已通过后端目录内的 `.gitignore` 排除。原文件按 SHA-256 保存，不使用用户文件名作为路径。

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

`POST /api/resumes/batch`，multipart 字段名为 **`files[]`**，每批 1–20 份、单份最多 15MB。

```bash
curl -X POST http://127.0.0.1:8000/api/resumes/batch \
  -F 'files[]=@resume.pdf' -F 'files[]=@resume.docx'
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
- 简历状态：`parsing → ready | need_review | failed`。少于 30 字但非空时标记 `need_review`，全文仍可读取；解析中的项目也会出现在 items 中。
- 至少一份可读取时任务为 `succeeded`，仍需逐项检查 `status/error`；全部失败时任务为 `failed`，任务 error 为首份文件错误。
- 异步错误形如 `{"code":"OCR_UNAVAILABLE","message":"中文提示"}`，通过 200 的查询结果返回；HTTP 级别错误则沿用原有含 `request_id` 的外层错误体。
- 进程启动和正常退出都会将未完成任务、仍在解析的简历标记失败，提示“服务重启，任务已中断，请重试”；已经完成的文件保留。
- 本版同批简历顺序解析，批次排队执行，不阻塞原有诊断接口的模型调用。

## 3. 读取全文

`GET /api/resumes/{resume_id}/text` 返回 **200**：

```json
{"resume_id":"简历ID","name":"张三.docx","chars":812,"text":"全文"}
```

解析中返回 409；失败时返回对应错误，不以空字符串冒充成功。

## 提取规则与错误

PDF 按平均每页至少 80 字使用文本层；低于阈值视为需要 OCR，本版返回 `OCR_UNAVAILABLE`。加密、损坏或超页数的 PDF 返回明确错误。DOCX 按正文顺序读取段落及表格，表格每行以 ` | ` 分隔，解压总大小限制为 32MB。

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
| 422 | `VALIDATION_ERROR` | multipart 字段缺失等请求格式错误 |
| 422 | `OCR_FAILED` | 提取清洗后没有文字 |
| 503 | `OCR_UNAVAILABLE` | 图片、扫描 PDF 需要 OCR |

`TASK_INTERRUPTED` 和 `INGEST_FAILED` 也会出现在任务/项目错误中，分别代表任务中断和意外解析失败。

## 首版验收与上线边界

1. 上传 20 份电子版简历，轮询直到完成，使用返回的 ID 读取全文。
2. 重复上传同一文件，验证 ID 相同且不重复提取。
3. 混合上传有效 DOCX 与扫描 PDF，验证有效文件正常出文本，扫描件有中文提示。
4. 验证空文件、伪造扩展名、超大文件、加密 PDF、空白 DOCX 不会留下永远解析中的记录。
5. 运行全部后端测试，确认旧诊断接口回归测试通过。

本次不修改前端、Nginx 或线上服务。仓库现有 Nginx 请求体上限为 256KB，轮询也共用接口限流；正式接入上传前需要部署负责人单独调整。批量请求体上限必须覆盖整批文件总量和 multipart 开销，仅设 20MB 无法支持 20 × 15MB 的上传。当前接口沿用已有无鉴权访问方式，不应向公网提供真实简历库，接入真实数据前需另行实现访问控制。
