# 部署说明

## 1. 首次申请公网 IP 的 HTTPS 证书

Let's Encrypt 已支持公网 IPv4/IPv6 证书。IP 证书有效期约 6 天，必须依赖自动续期；Certbot 需 5.4 或更高版本。

先保留服务器现有的 HTTP 配置，并确保 `/var/www/resume-diagnose/.well-known/acme-challenge/` 能从公网访问，然后申请证书：

```bash
sudo mkdir -p /var/www/resume-diagnose/.well-known/acme-challenge
sudo certbot certonly \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/resume-diagnose \
  --ip-address 8.163.105.39
```

先用测试续期确认定时任务可用，再安装 reload hook：

```bash
sudo certbot renew --dry-run
sudo sh -c 'printf "%s\n" "#!/bin/sh" "systemctl reload nginx" > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh'
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

## 2. 构建前端并启用 HTTPS Nginx 配置

`http.server` 是单线程的开发用服务器，不适合线上。改用 [nginx.conf](nginx.conf)：

```bash
cd frontend
# 走 Nginx 同源代理时，后端地址留空
VITE_API_BASE= npm run build
sudo mkdir -p /var/www/resume-diagnose
sudo cp -r dist/* /var/www/resume-diagnose/
sudo cp ../deploy/nginx.conf /etc/nginx/conf.d/resume-diagnose.conf
sudo nginx -t && sudo systemctl reload nginx
```

部署后确认 `http://8.163.105.39/` 会跳转到 `https://8.163.105.39/`，并检查证书自动续期。不要在证书签发前复制新版 `nginx.conf`，否则 Nginx 会因证书文件尚不存在而无法加载。

## 后端环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `LLM_API_KEY` | 无 | 智谱 API Key，必填 |
| `MOCK_MODE` | `false` | 只有显式设为 `true` 才返回 mock；线上保持 `false` |
| `CORS_ORIGINS` | `https://8.163.105.39,http://localhost:5173,http://127.0.0.1:5173` | 允许跨域的前端地址，英文逗号分隔；走 Nginx 同源代理时可不改 |
| `ENABLE_DOCS` | `false` | 设为 `true` 才开放 `/docs`、`/redoc`、`/openapi.json`，仅限本地调试；生产保持 `false` |
| `DATA_DIR` | `backend/data` | SQLite 数据库与上传原件目录。生产建议用仓库外的绝对路径，例如 `/var/lib/resume-diagnose`，重新部署代码时不会丢数据 |
| `MAX_UPLOAD_MB` | `15` | 单份文件上限（1–15） |
| `OCR_MAX_PAGES` | `10` | PDF 页数上限 |
| `OCR_PROVIDER` | `auto` | `auto` 使用离线 RapidOCR；`stub` 关闭 OCR（图片与扫描件会返回“OCR 不可用”） |
| `MATCH_LLM_TOP_K` | `8` | 基础分前 K 份做 AI 深度分析，上限 8；设 `0` 只做基础评分 |
| `MATCH_CONCURRENCY` | `3` | AI 分析全局并发，上限 3 |

## 3. 简历筛选功能（上传 / OCR / 匹配 / 导出）

### 3.1 安装依赖（Python 3.11+）

```bash
cd /path/to/zzu-ai-b2
python3.11 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-ocr.txt
# 验证 OCR 引擎能加载（首次会解压 ONNX 模型，约 10 秒）
.venv/bin/python -c "from rapidocr_onnxruntime import RapidOCR; RapidOCR(); print('OCR ok')"
```

RapidOCR 依赖 `onnxruntime`，在部分精简 Linux 镜像上还需要系统库：`sudo apt-get install -y libgl1 libglib2.0-0`（Debian/Ubuntu）或 `sudo yum install -y mesa-libGL`（CentOS/Alibaba Cloud Linux）。

### 3.2 数据目录

```bash
sudo mkdir -p /var/lib/resume-diagnose
sudo chown <运行后端的用户>:<组> /var/lib/resume-diagnose
sudo chmod 700 /var/lib/resume-diagnose
```

在 `backend/.env` 里设置 `DATA_DIR=/var/lib/resume-diagnose`。目录里的 `app.db` 和 `uploads/` 含真实简历，**不要提交到 Git，也不要放在 Nginx 能直接访问的目录下**。

### 3.3 只能运行一个 worker

解析和匹配任务在进程内执行，状态存在 SQLite。多个 worker 会互相看不到任务，因此必须单进程运行：

```bash
cd backend
../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

建议用 systemd 托管（`/etc/systemd/system/resume-diagnose.service`）：

```ini
[Unit]
Description=resume diagnose backend
After=network.target

[Service]
User=<运行后端的用户>
WorkingDirectory=/path/to/zzu-ai-b2/backend
ExecStart=/path/to/zzu-ai-b2/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

服务重启时，未完成的解析/匹配任务会被标记为“服务重启，任务已中断，请重试”，已解析完成的简历保留。

### 3.4 Nginx 上传与限流

[nginx.conf](nginx.conf) 已按接口区分：

| 接口 | 请求体上限 | 限流（每 IP） |
|---|---|---|
| `POST /api/diagnose`、`POST /api/match` | 256KB | 每分钟 10 次，突发 3 |
| `POST /api/interviews`、`POST /api/interviews/{id}/answers` | 256KB | 与上一行共用每分钟 10 次、突发 3；代理超时 85 秒（后端单轮预算 75 秒） |
| `POST /api/resumes/batch` | 60MB | 每分钟 12 次，突发 8 |
| 其余 `/api/`（任务轮询、全文、导出） | 256KB | 每分钟 240 次，突发 60 |

前端会把文件按每批最多 5 份、50MB 拆开上传，所以 60MB 足够；20 份 × 15MB 一次性上传（不拆批的客户端）会被拒绝并返回 413。

### 3.5 上线后检查

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://8.163.105.39/      # 前端可访问，应为 200
curl -s -o /dev/null -w "%{http_code}\n" https://8.163.105.39/docs       # 应为 404
```

然后在浏览器里完成一次：上传混合格式简历 → 解析完成 → 开始匹配 → 展开报告 → 导出 Excel。

## 4. 发布回退

发布前先记下当前版本并备份数据：

```bash
git -C /path/to/zzu-ai-b2 rev-parse HEAD > ~/release-prev.txt
sudo cp -a /var/www/resume-diagnose ~/www-backup-$(date +%F)
sudo cp /etc/nginx/conf.d/resume-diagnose.conf ~/nginx-backup-$(date +%F).conf
sqlite3 /var/lib/resume-diagnose/app.db ".backup ~/app-db-backup-$(date +%F).db"
```

需要回退时：

```bash
git -C /path/to/zzu-ai-b2 checkout $(cat ~/release-prev.txt)
sudo systemctl restart resume-diagnose
sudo rm -rf /var/www/resume-diagnose && sudo cp -a ~/www-backup-<日期> /var/www/resume-diagnose
sudo cp ~/nginx-backup-<日期>.conf /etc/nginx/conf.d/resume-diagnose.conf && sudo nginx -t && sudo systemctl reload nginx
```

数据库只会新增表和列（`llm_cache`、`low_conf`），旧版本代码读取新库不受影响，一般不需要回滚数据库；确需回滚时停服务后用备份覆盖 `app.db`。

## 限流

限流规则见 3.4 节。超出时返回 429 和 JSON 错误，前端会提示「请求过于频繁」。

**限流和 HTTPS 只对经过 Nginx 的请求有效。** 后端必须只监听本机，并在云服务器安全组里关掉 8000 端口的公网访问，否则别人可以绕过 TLS 和限流直接请求后端：

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
```
