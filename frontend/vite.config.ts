import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 用 "." 作为 envDir，避免依赖 node 类型（项目未装 @types/node）
  const env = loadEnv(mode, ".", "");
  // 默认代理到本地后端；联调远程环境时用 VITE_PROXY_TARGET 覆盖
  const proxyTarget = env.VITE_PROXY_TARGET || "http://127.0.0.1:8000";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // 前端统一请求同源 /api，由 vite 代理转发，避免跨域与硬编码地址
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
          // 远程联调地址用自签证书时不想每次报错
          secure: false,
        },
      },
    },
  };
});
