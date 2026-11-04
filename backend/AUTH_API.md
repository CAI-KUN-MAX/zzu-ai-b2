# 登录与身份隔离契约

认证接口使用同源 JSON 和 `/api/auth` 前缀。用户名为 4–20 位 ASCII 字母、数字或下划线，查询前转小写；密码为 8–128 个字符，保留空格。认证响应均为 `Cache-Control: no-store`。

- `POST /api/auth/register`：`{"username":"student01","password":"示例密码占位"}`；成功 201 返回 `{"user":{"id":"usr_...","username":"student01"}}` 并登录。重复用户名返回 409 `USERNAME_ALREADY_TAKEN`。
- `POST /api/auth/login`：同样的请求体，成功 200 返回同样的 user；错误凭据返回 401 `INVALID_CREDENTIALS`。
- `GET /api/auth/me`：返回 `{"authenticated":true,"user":{...}}`，过期或未登录时返回 `{"authenticated":false,"user":null}`。
- `POST /api/auth/logout`：撤销当前会话，返回 `{"ok":true}`；重复退出仍成功。

非法输入返回 422 `VALIDATION_ERROR`；注册与登录限流返回 429 `RATE_LIMITED` 和 `Retry-After`。错误体沿用 `{"error":{"code":"...","message":"...","request_id":"..."}}`。

注册与登录分别按固定的 60 秒窗口限流：每个客户端地址最多 10 次、每个规范化用户名最多 20 次。客户端地址来自服务端识别的直连地址；反向代理必须正确配置可信代理，否则多个用户可能共用代理地址限额。密码使用独立随机盐的 scrypt（N=16384、r=8、p=1），哈希计算限制为最多四个并发。

登录 Cookie 为随机服务端会话标识，有效期 7 天，HttpOnly、SameSite=Lax，HTTPS 时 Secure；登录成功轮换标识，服务端仅保存其哈希。所有状态修改请求必须带可信 Origin 和 `X-CSRF-Token`，其值从先前 `GET /api/auth/me` 设置的 `resume_csrf` Cookie 读取。前端须在上传、匹配、面试、诊断等 POST 请求中也发送该头。无效来源或令牌返回 403。跨域仅允许配置的可信前端来源；生产代理必须仅信任已知代理的转发协议头。

登录后资源归账号所有，退出恢复原游客空间，不自动认领游客数据；不同身份即使上传相同文件也不能获得对方资源。未授权资源返回 404。已有游客授权保留。升级前停止服务并备份整个数据目录；回滚时恢复升级前备份，备份之后创建的数据需要单独恢复处理。
