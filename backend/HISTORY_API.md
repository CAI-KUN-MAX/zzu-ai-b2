# 历史记录契约

现有 SQLite tasks/resumes/interviews 与 guest_acl 保存记录，不新增表、迁移或改写既有数据。

`GET /api/history?kind=all&page=1&page_size=20`，kind 为 all/job_match/resume/interview，page_size 1–50。返回 `{items,total,page,page_size}`。按创建时间与 ID 倒序分页。条目字段：id、kind、status、created_at、updated_at、title、resume_id、resume_name、resume_status、job_ids（列表为空数组）、mode、ingest_task_id、round、max_rounds；不返回原文、文件路径、指纹、Cookie 或所有者标识。

`GET /api/history/{kind}/{id}` 返回 `{entry,match?,resume?,interview?}`。match 包含可恢复结果页的 taskId/resumeId/resumeName/resumeStatus/jobIds/jobIndex/savedAt/mode，jobIndex 使用任务创建时 JD 快照；resume 为 resume_id/name/status/text/chars；interview 为 resume_id/resume_name/jd_text/status/round/max_rounds/expired/turns/question，turns 含原问题、回答及反馈。

所有请求按当前 Cookie 对应账号或游客 ACL 隔离；列表与详情都验证资源归属，越权/不存在统一 404 HISTORY_NOT_FOUND，响应 Cache-Control:no-store。游客需保留该浏览器 Cookie；清除 Cookie 或更换浏览器不能恢复游客历史。账号历史跟随账号，无需本地缓存；登录不会自动导入游客记录。列表无 24 小时过滤；过期面试仍可只读回看，原答题接口的 24 小时限制不变。无删除或迁移接口。
