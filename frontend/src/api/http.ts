/**
 * 通用 HTTP 层：base 地址、超时、错误体归一、JSON 解析。
 * 所有 api/*.ts 都走这里，页面只读 error.message。
 */

/** 只有 .env 里明确写 VITE_USE_MOCK=true 才启用 mock，漏配时默认请求真实后端 */
export const IS_MOCK_MODE = import.meta.env.VITE_USE_MOCK === "true";

export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

/** 诊断 / 匹配结果类请求超时，需大于后端总超时（75s） */
export const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT ?? 80000);

/** 上传类请求单独超时：批量解析比单次诊断慢得多 */
export const UPLOAD_TIMEOUT_MS = Number(import.meta.env.VITE_API_UPLOAD_TIMEOUT ?? 120000);

/** 统一的业务异常，页面只需要读 message 做提示 */
export class ApiError extends Error {
  readonly code: string | number | null;
  /** 后端返回的追踪号，便于日志对账 */
  readonly requestId: string | null;
  /** HTTP 状态码；网络错误、超时等没有响应时为 null */
  status: number | null = null;

  constructor(
    message: string,
    code: string | number | null = null,
    requestId: string | null = null
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.requestId = requestId;
  }
}

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 后端错误体有三种形态，这里统一成一句可读的中文提示：
 * 1. 契约预留 { error: { code, message } }
 * 2. FastAPI 默认 { detail: "..." }
 * 3. FastAPI 422 { detail: [ { loc, msg } ] }
 */
export function toApiError(parsed: unknown, status: number): ApiError {
  const error = buildApiError(parsed, status);
  error.status = status;
  return error;
}

function buildApiError(parsed: unknown, status: number): ApiError {
  const body = (parsed ?? {}) as {
    error?: { code?: string | number; message?: string; request_id?: string };
    detail?: string | Array<Record<string, unknown>>;
    code?: string | number;
    message?: string;
  };

  const requestId = body.error?.request_id ?? null;
  // 有追踪号就带上，用户报障时能直接定位到一条日志
  const withRequestId = (message: string) =>
    requestId ? `${message}（请求编号：${requestId}）` : message;

  // 504 是模型确实超时，和生成失败分开提示，用户才知道该等还是该精简内容；
  // 后端给了具体说明（如面试“本轮尚未推进”）就用后端原文
  if (status === 504) {
    return new ApiError(
      withRequestId(body.error?.message ?? "AI 响应超时，请稍后重试；内容较长时可适当精简"),
      body.error?.code ?? status,
      requestId
    );
  }

  // 后端自己给出的业务错误（如 503 OCR_UNAVAILABLE）保留原意，不能改成“AI 正在思考中”
  if (status >= 500 && body.error?.message && body.error.code !== "INTERNAL_ERROR") {
    return new ApiError(withRequestId(body.error.message), body.error.code ?? status, requestId);
  }

  // 其余 5xx 多为大模型生成失败或网关报错，错误体通常不可读，统一给人话提示
  if (status >= 500) {
    return new ApiError(withRequestId("服务暂时未能完成请求，请稍后重试；已输入的内容会保留"), status, requestId);
  }

  if (status === 429 && !body.error?.message) {
    return new ApiError(withRequestId("请求过于频繁，请 1 分钟后再试"), status, requestId);
  }

  if (body.error?.message) {
    return new ApiError(body.error.message, body.error.code ?? status, requestId);
  }

  if (typeof body.detail === "string" && body.detail.trim()) {
    return new ApiError(body.detail, status, requestId);
  }

  if (Array.isArray(body.detail) && body.detail.length > 0) {
    const first = body.detail[0] as { loc?: unknown[]; msg?: string };
    const field = Array.isArray(first.loc)
      ? first.loc.filter((item) => item !== "body").join(".")
      : "";
    const reason = first.msg ?? "请求参数不合法";
    return new ApiError(field ? `参数 ${field}：${reason}` : reason, status, requestId);
  }

  if (typeof body.message === "string" && body.message.trim()) {
    return new ApiError(body.message, body.code ?? status, requestId);
  }

  return new ApiError(`请求失败（HTTP ${status}）`, status, requestId);
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: BodyInit | null;
  /** 注意：上传 FormData 时不要传 Content-Type，边界由浏览器生成 */
  headers?: Record<string, string>;
  /** 毫秒，默认 TIMEOUT_MS */
  timeout?: number;
  /** 超时提示文案，不同接口可以给不同的说法 */
  timeoutMessage?: string;
  /** 外部取消（轮询 cleanup、页面卸载） */
  signal?: AbortSignal;
}

/** 发起请求并解析 JSON；失败一律抛 ApiError */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    body = null,
    headers = {},
    timeout = TIMEOUT_MS,
    timeoutMessage,
    signal,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  // 外部要取消时，同步掐断内部请求
  const forwardAbort = () => controller.abort();
  signal?.addEventListener("abort", forwardAbort);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Accept: "application/json", ...headers },
      body,
      signal: controller.signal,
    });

    const raw = await res.text();
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        // 网关（Nginx）报错时返回的是 HTML，按状态码给提示即可
        if (res.ok) throw new ApiError("服务返回的内容不是合法 JSON");
      }
    }

    if (!res.ok) {
      throw toApiError(parsed, res.status);
    }

    if (!parsed || typeof parsed !== "object") {
      throw new ApiError("服务返回了空结果");
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    if (error instanceof DOMException && error.name === "AbortError") {
      // 外部主动取消不算异常，交给调用方识别
      if (signal?.aborted) throw new ApiError("请求已取消");
      throw new ApiError(
        timeoutMessage ?? `请求超时（${Math.round(timeout / 1000)} 秒），请稍后重试`
      );
    }

    throw new ApiError("网络异常，无法连接服务");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}
