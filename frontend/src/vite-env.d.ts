/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" 时使用本地 mock 数据，不发真实请求 */
  readonly VITE_USE_MOCK?: string;
  /** 接口基础地址，留空则走 vite 代理（同源 /api） */
  readonly VITE_API_BASE?: string;
  /** 单次请求超时（毫秒） */
  readonly VITE_API_TIMEOUT?: string;
  /** 上传类请求超时（毫秒），批量解析比单次诊断慢 */
  readonly VITE_API_UPLOAD_TIMEOUT?: string;
  /** 模拟面试单轮请求超时（毫秒），默认 90000 */
  readonly VITE_API_INTERVIEW_TIMEOUT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
