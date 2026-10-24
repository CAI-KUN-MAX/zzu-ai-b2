# 简历诊断 · 前端

简历与岗位 JD 的 AI 匹配诊断工具前端。粘贴简历与 JD，输出总分、维度得分、亮点与待补齐项。

## 技术栈

- Vite 6 + React 18 + TypeScript
- Tailwind CSS 3（自定义 `ink / surface / brand` 色板）
- 无路由库，两个页面用状态切换（体量小，没必要引 react-router）

## 快速开始

```bash
npm install
cp .env.example .env   # 仓库不提交 .env，首次运行需要复制一份模板
npm run dev            # http://localhost:5173
```

默认 **mock 模式**，不依赖后端即可跑通完整交互。

```bash
npm run build      # 类型检查 + 生产构建
npm run typecheck  # 只做类型检查
```

## mock / 真实接口切换

配置在 `.env`（首次使用从 `.env.example` 复制）：

| 变量 | 说明 |
| --- | --- |
| `VITE_USE_MOCK` | 只有写 `true` 才用本地 mock（`src/mock/response.json`）离线跑 UI；不写或写其他值都请求真实后端 |
| `VITE_API_BASE` | 后端地址，默认 `http://8.163.105.39:8000`；留空则走 vite 代理（同源 `/api`） |
| `VITE_API_TIMEOUT` | 单次请求超时（ms），默认 80000。需大于后端总超时 75s；实测 GLM-4 单次 15–50s |

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
├─ types.ts                 # 接口契约类型（与后端字段一一对应，结构冻结）
├─ api/diagnose.ts          # 请求封装：mock 分支、超时、错误归一化
├─ mock/response.json       # 后端真实返回样例（另补了 2 条同结构条目用于验证多卡片布局）
├─ lib/
│  ├─ theme.ts              # 分数/等级/严重度的配色映射
│  ├─ sample.ts             # 「填入示例」用的演示文案
│  └─ useCountUp.ts         # 总分滚动动画
├─ components/
│  ├─ Header.tsx            # 顶栏 + mock/真实状态徽章
│  ├─ InputPage.tsx         # 输入页：简历 / JD 双栏、字数统计、校验、示例填充
│  ├─ ResultPage.tsx        # 结果页：总分卡 / 维度条 / 亮点 / 缺口 / 免责声明
│  ├─ ScoreRing.tsx         # 环形总分
│  └─ icons.tsx             # 内联 SVG 图标（不引图标库）
├─ App.tsx                  # 视图切换 + 请求编排
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
- `gaps[]`：`title / jd_requirement / resume_evidence / suggestion / severity`，其中 `resume_evidence` 可能为 `null`；按 `high → medium → low` 返回和展示

错误约定：后端可能返回三种形态，前端已统一兼容 ——
FastAPI 默认 `{"detail": "..."}`、422 校验 `{"detail": [{"loc","msg"}]}`、标准错误
`{"error": {"code","message","request_id"}}`。服务端错误会在页面保留 `request_id`，便于按日志排查。

## 已处理的前端健壮性

- 请求超时（AbortController，默认 45s），避免大模型链路卡死无反馈
- 5xx 统一给出可读提示并保留请求编号，方便用户反馈和服务端查日志
- 请求期间进入分阶段 Loading（解析简历 → 匹配要求 → 深度诊断），带已等待秒数
- 响应非 JSON / 空 body / 字段缺失时给出可读提示，不白屏
- `dimension_scores` 等数组缺失时降级为空列表并给出占位文案
- 未知 `level` / `severity` 枚举值落到 medium 样式，不崩
- 提交前校验两段文本不少于 30 字，按钮防重复点击

## 待办

- [ ] 结果页「复制诊断结果 / 导出」按钮
- [ ] 历史诊断记录（需后端支持）
- [ ] 大模型耗时较长时接 SSE 流式输出
