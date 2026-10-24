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
| `ENABLE_DOCS` | `false` | 设为 `true` 才开放 `/docs`、`/redoc`、`/openapi.json`，仅限本地调试 |

## 限流

[nginx.conf](nginx.conf) 对 `/api/` 按 IP 限流：每分钟 10 次，允许突发 3 次，超出返回 429 和 JSON 错误，前端会提示「请求过于频繁」。

**限流和 HTTPS 只对经过 Nginx 的请求有效。** 后端必须只监听本机，并在云服务器安全组里关掉 8000 端口的公网访问，否则别人可以绕过 TLS 和限流直接请求后端：

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
```
