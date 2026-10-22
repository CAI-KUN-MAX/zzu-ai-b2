# 部署说明

## 前端：用 Nginx 代替 `python -m http.server`

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

## 后端环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `LLM_API_KEY` | 无 | 智谱 API Key，必填 |
| `MOCK_MODE` | `true` | 线上设为 `false` |
| `CORS_ORIGINS` | `http://8.163.105.39,http://localhost:5173,http://127.0.0.1:5173` | 允许跨域的前端地址，英文逗号分隔；走 Nginx 同源代理时可不改 |
| `ENABLE_DOCS` | `false` | 设为 `true` 才开放 `/docs`、`/redoc`、`/openapi.json`，仅限本地调试 |

后端只需监听本机：`uvicorn app.main:app --host 127.0.0.1 --port 8000`。改走 Nginx 后，可以在安全组里关掉 8000 端口的公网访问。
