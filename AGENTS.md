# 仓库事实与验证命令

遵守当前会话及全局安全规则；本文件只补充已核实的项目事实。

- 后端：Python 3.11+、FastAPI、Pydantic 2；入口 `backend/app/main.py`。SQLite 使用标准库 sqlite3，不使用 ORM；现有 Store 初始化数据库，新岗位功能不新增表或迁移。
- 前端：TypeScript、React 18、Vite 6、Tailwind；入口 `frontend/src/main.tsx`。本轮岗位匹配交付不修改前端页面。
- 既有简历解析使用 PDF/DOCX 提取、可选 RapidOCR；模型调用使用现有 OpenAI SDK 兼容接口。不得把字符 2-gram 相似度称为 Embedding 或语义向量匹配。
- 新岗位功能：`job_schemas.py` 定义契约，`routers/jobs.py` 负责 HTTP，`job_matching.py` 编排业务，`job_repository.py` 读取静态目录与访问现有任务存储。复用 matching 的评分、缓存和共享并发限制，不在新 router/service 中直接写 SQL。
- 岗位目录位于 `backend/catalogue/`；日期或完整 JD 缺失的原始数据不能混入正式目录，未确认可投的记录必须标为 unverified，不能计入 40 个可投岗位验收。
- 现有接口文档见 `backend/API.md`，新契约见 `backend/JOB_MATCH_API.md`。先改契约及独立示例，再改实现；保持旧 `/api/match` 兼容。
- 后端测试框架为 unittest。在 `backend/` 下执行：`..\.venv\Scripts\python.exe -m unittest discover -s tests -v`，测试进程设置 `ENABLE_DOCS=false`；安装了既有 OCR 依赖时可设置 `TEST_REAL_OCR=1` 运行真实离线 OCR 回归。
- 编译检查（仓库根目录）：`.\.venv\Scripts\python.exe -m compileall -q backend/app backend/scripts backend/tests`。当前未配置独立后端 linter/formatter。
- 岗位验收（仓库根目录）：`.\.venv\Scripts\python.exe backend/scripts/check_job_catalogue.py --as-of YYYY-MM-DD --require-target`。结构通过与数量达标是两件事，target_met=false 时不得声称岗位集已验收。
- 前端既有检查：在 `frontend/` 执行 `npm run typecheck`、`npm run build`。部署 Nginx 配置需要在有 Nginx 的环境执行 `nginx -t` 后才可启用；不得把本地配置编辑说成已部署。
