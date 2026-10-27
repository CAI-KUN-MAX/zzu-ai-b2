# 简历诊断 · 前端

主导航只有一条链路：**上传 1 份简历 → 勾选多个岗位 → 按匹配度排序 → 点开看完整 JD 与诊断 → 针对该岗位练五轮面试**。

> 简历筛选（一份 JD 筛多份简历）与文本诊断的页面文件仍保留在仓库中，但不再作为主导航入口；
> 单份诊断能力已包含在岗位详情里。

## 技术栈

- Vite 6 + React 18 + TypeScript
- Tailwind CSS 3（自定义 `ink / surface / brand` 色板）
- 无路由库：`App.tsx` 用 `View` 联合类型切页面；无状态库，`useState` + `useTask` 轮询足够

## 快速开始

```bash
npm install
cp .env.example .env   # 仓库不提交 .env，首次运行需要复制一份模板
npm run dev            # http://localhost:5173
```

默认请求真实后端；需要离线调试界面时，显式设置 `VITE_USE_MOCK=true`。

```bash
npm run build      # 类型检查 + 生产构建
npm run typecheck  # 只做类型检查
```

## mock / 真实接口切换

配置在 `.env`（首次使用从 `.env.example` 复制）：

| 变量 | 说明 |
| --- | --- |
| `VITE_USE_MOCK` | 只有写 `true` 才用本地 mock 数据离线跑 UI；不写或写其他值都请求真实后端 |
| `VITE_API_BASE` | 默认留空并走同源 `/api`：本地由 Vite 代理，线上由 Nginx HTTPS 代理；生产环境禁止直连 `:8000` |
| `VITE_API_TIMEOUT` | 单次请求超时（ms），默认 80000。需大于后端总超时 75s；实测 GLM-4 单次 15–50s |
| `VITE_API_UPLOAD_TIMEOUT` | 上传 / 批量解析超时（ms），默认 120000 |

默认就请求真实后端；只想离线调 UI 时才把 `VITE_USE_MOCK` 设为 `true`：

```bash
# .env
VITE_USE_MOCK=false
VITE_API_BASE=
```

`vite.config.ts` 里已配 `/api -> http://127.0.0.1:8000` 代理，前后端同源，不依赖后端开 CORS（开了也不冲突）。

## 目录结构

```
src/
├─ types.ts                 # 接口契约类型（诊断 + 筛选两套）
├─ api/
│  ├─ http.ts               # 通用 fetch：base / 超时 / 错误归一 / JSON 解析
│  ├─ diagnose.ts           # 单份诊断（对外签名不变，内部改走 http.ts）
│  ├─ resumes.ts            # 上传、解析任务、简历全文、文件校验与拆批
│  └─ match.ts              # 建匹配任务、匹配结果、导出地址
├─ mock/
│  ├─ response.json         # 单份诊断返回样例
│  ├─ ingest.json           # 8 份简历解析结果，覆盖 ready / need_review / failed
│  └─ match.json            # 7 条匹配结果，覆盖 high / medium / low、degraded 有无 report
├─ lib/
│  ├─ theme.ts              # 分数/等级/严重度的配色映射
│  ├─ sample.ts             # 「填入示例」用的演示文案
│  ├─ useTask.ts            # 通用轮询 hook（退避 / 硬超时 / 连续失败才提示）
│  └─ useCountUp.ts         # 总分滚动动画
├─ components/
│  ├─ Header.tsx / Nav.tsx  # 顶栏 + 两个业务入口切换
│  ├─ InputPage.tsx         # 文本诊断：简历 / JD 双栏、字数统计、校验、示例填充
│  ├─ ResultPage.tsx        # 单份诊断结果页
│  ├─ ScreenPage.tsx        # 简历筛选：JD + 拖拽上传 + 解析进度
│  ├─ ScreenResultPage.tsx  # 筛选结果：排序表格 + 行内展开
│  ├─ JdPanel.tsx / DropZone.tsx
│  ├─ report/               # 维度条 / 亮点 / 缺口，两个结果页共用
│  ├─ ScoreRing.tsx         # 环形总分
│  └─ icons.tsx             # 内联 SVG 图标（不引图标库）
├─ App.tsx                  # View 联合类型：input / report / screen / screenResult
└─ index.css                # Tailwind 入口 + 入场动画
```

## 接口契约

`POST /api/diagnose`，字段与后端 `backend/app/schemas.py` 一一对应。

请求：

```json
{
  "resume_text": "简历全文",
  "jd_text": "JD 全文",
  "options": { "language": "zh-CN", "include_suggestions": true }
}
```

`options` 可省略，后端有默认值。`include_suggestions: false` 时，返回的缺口仍保留，
但 `suggestion` 为空字符串，结果页不会展示改进建议区域。

响应结构见 `src/types.ts` 的 `DiagnoseResponse`。关键字段：

- `overall_score`：0-100 总分
- `level` / `level_label`：等级枚举 + 展示文案（文案由后端下发，前端不自造）
- `dimension_scores[]`：`key / label / score / weight`
- `highlights[]`：`title / evidence / source`
- `gaps[]`：`title / jd_requirement / resume_evidence / suggestion / severity`，其中 `resume_evidence` 可能为 `null`，`suggestion` 可能为空串；按 `high → medium → low` 返回和展示

错误约定：后端可能返回三种形态，前端已统一兼容 ——
FastAPI 默认 `{"detail": "..."}`、422 校验 `{"detail": [{"loc","msg"}]}`、标准错误
`{"error": {"code","message","request_id"}}`。服务端错误会在页面保留 `request_id`，便于按日志排查。

## 已处理的前端健壮性

- 请求超时（AbortController，默认 45s），避免大模型链路卡死无反馈
- 5xx 统一提示「AI 正在思考中，请稍后重试」，并给一键重试，输入内容不丢
- 请求期间进入分阶段 Loading（解析简历 → 匹配要求 → 深度诊断），带已等待秒数
- 响应非 JSON / 空 body / 字段缺失时给出可读提示，不白屏
- `dimension_scores` 等数组缺失时降级为空列表并给出占位文案
- 未知 `level` / `severity` 枚举值落到 medium 样式，不崩
- 提交前校验两段文本不少于 30 字，按钮防重复点击

## 简历筛选（批量）

### 流程

上传文件 → `POST /api/resumes/batch` 拿 `task_id` → 轮询 `GET /api/tasks/{id}` 看解析进度 →
解析成功后 `POST /api/match` 建匹配任务 → 轮询 `GET /api/match/{id}` → 结果表格。

### 六个接口

| 接口 | 说明 |
| --- | --- |
| `POST /api/resumes/batch` | multipart `files[]`（≤20 份），返回 202 `{task_id}` |
| `GET /api/tasks/{task_id}` | 解析进度与逐份状态 `ready / need_review / failed` |
| `GET /api/resumes/{id}/text` | 展开看简历全文 |
| `POST /api/match` | `{jd_text, resume_ids}`，返回 202 `{task_id}` |
| `GET /api/match/{task_id}` | 匹配进度与排序结果，`report` 字段与 `/api/diagnose` 结构一致 |
| `GET /api/match/{id}/export` | 导出 xlsx（P1，mock 下不可用） |

字段定义见 `src/types.ts` 的 `IngestTask` / `MatchTask`；请求统一走 `src/api/http.ts`，
错误体由它归一到 `message`。

### 轮询规则（`src/lib/useTask.ts`）

- 立即拉一次，之后 1s → 2s → 3s 退避，上限 3s
- `succeeded` / `failed` 立即停；组件卸载或切页面用 `AbortController` 掐断
- 10 分钟硬超时，提示「分析时间较长，可稍后刷新查看」
- 连续 3 次请求失败才提示，避免网络抖动刷屏

### 实现要点

- 上传用 `FormData` 且**不设** `Content-Type`，边界交给浏览器，否则必失败
- 单批超过 50MB 或 20 份时按 5 份一批串行提交（`splitIntoBatches`）
- `need_review` 的简历在解析列表里高亮并提示核对；`failed` 的不进入匹配
- 表格行内展开才渲染 `report`，避免一次渲染 20 份明细卡顿
- 老功能与筛选页共用 `components/report/*`（维度条 / 亮点 / 缺口），样式完全一致

## 岗位匹配（简历 → 多个岗位）

主入口。上传一份简历，从后端已核验可投的岗位目录中勾选候选岗位，按匹配度排序。当前不支持自定义岗位。

### 流程

上传简历（复用 `POST /api/resumes/batch`，单文件）→ 轮询解析 →
`POST /api/job-matches` 建任务 → 轮询 `GET /api/job-matches/{id}` →
岗位排序列表 → 点开岗位看命中项、缺口及可用的 AI 报告 → 从任务上下文获取原简历 ID 和 JD 快照 → `InterviewPage` 练五轮。

### 接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/jobs` | 默认只列出 `open` 岗位，可按类别、学历分页筛选 |
| `POST /api/job-matches` | `{resume_id, job_ids:["岗位ID"]}` → 202 `{task_id}`，最多 50 个岗位 |
| `GET /api/job-matches/{task_id}` | `{status, stage, progress, error, error_code, items:[{job_id, title, score, stage1_score, subscores, matched, missing, reason, degraded, degraded_reason, analysis_status, report?}]}` |
| `GET /api/job-matches/{task_id}/items/{job_id}/context` | 返回可直接传给现有诊断和面试接口的 `diagnose_request`、`interview_request` |

真实 AI 成功时，`report` 与 `/api/diagnose` 响应结构一致；降级时只出基础分。面试只使用 context 中的原简历 ID 和 JD 快照。当前目录只有 5 个已核验 `open` 岗位，另有 45 条 `unverified` 线索，尚未达到 40 岗验收目标。基础评分中的 2-gram 是字符文本相似度，当前没有接入 Embedding。

### 层级关系

页面 → 岗位详情（`z-30` 覆盖层）→ 模拟面试（`z-40` 覆盖层）。
两层都用覆盖层而不是路由，返回时列表与详情状态都不丢，也不会重新拉一次匹配任务。

### 文案口径

- 匹配分：关键词 + 文本相似度等**规则**计算
- 推荐理由 / 诊断：仅真实 AI 报告存在时展示；面试反馈由面试接口生成
- `degraded` 的岗位明确标注「只出了基础匹配分，没有做深度诊断」

## 模拟面试（单人 · 五轮）

入口在**筛选结果页的展开详情底部**，只针对「这一份简历 + 当前 JD」，不向整批发起。
面试以覆盖层打开，原筛选页不卸载，返回后展开状态和已生成的报告都还在。

### 流程

确认（简历名 / 岗位摘要 / 轮次说明）→ `POST /api/interviews` 拿第一题 →
回答后 `POST /api/interviews/{id}/answers` 拿反馈 + 下一题 → 五轮后展示汇总。

轮数以接口返回的 `max_rounds` 为准，页面不写死轮数（创建前的确认页用契约默认值 5）。
输入框支持浏览器原生语音识别（简体中文），识别文字进可编辑输入框，**不自动提交、不上传原始音频**；
不支持或权限被拒时仍可正常打字。

### 两个接口

| 接口 | 说明 |
| --- | --- |
| `POST /api/interviews` | `{resume_id, jd_text}` → 201 `{interview_id, status, round, max_rounds, question}` |
| `POST /api/interviews/{id}/answers` | `{question_id, answer_text}` → 200 `{feedback, next_question, ...}` |

`round` 语义：创建响应里是**当前题号**，回答响应里是**刚完成的轮次**；第五轮后
`status="completed"`、`next_question=null`。字段定义见 `src/types.ts`。

### 实现要点

- 回答去空白后 20–3000 字，按钮随校验与请求状态禁用；提交中 textarea 只读但内容保留
- 失败保留输入可直接重试；`404/410` 判定会话失效，给「重新开始」入口
- 请求超时单独走 `VITE_API_INTERVIEW_TIMEOUT`（默认 90s），不与诊断/上传混用
- 防重复提交用 `useRef` 同步闸门（`setState` 异步，快速双击会漏拦）；同一题重试在
  mock 里命中缓存，不会重复追加消息
- 准入看简历全文是否可用：解析失败的不给入口，`need_review` 的进入前提示先核对
- 不展示「录用建议」「通过概率」等没有依据的判断

### mock 覆盖

`VITE_USE_MOCK=true` 时用 `src/mock/interview.json` 的三道题与三套反馈，1.2s / 1.5s 模拟延迟。
覆盖：创建成功、三轮完成、同一题重试幂等、`question_id` 不匹配时的会话失效。

> ⚠️ 线上 `/api/interviews` 目前返回 404（后端未实现）。真实联调需要接口就绪后进行，
> 在此之前该功能状态为**仅 mock 完成**。

## 待办

- [ ] 结果页「复制诊断结果 / 导出」按钮
- [ ] 历史诊断记录（需后端支持）
- [ ] 大模型耗时较长时接 SSE 流式输出
