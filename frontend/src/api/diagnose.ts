import type { ApiErrorBody, DiagnoseRequest, DiagnoseResponse } from "../types";
import mockResponse from "../mock/response.json";

/** 是否处于 mock 模式：只有 .env 里明确写 VITE_USE_MOCK=true 才启用，漏配时默认请求真实后端 */
export const IS_MOCK_MODE = import.meta.env.VITE_USE_MOCK === "true";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");
// 需大于后端 TOTAL_TIMEOUT（75 秒），否则后端还在算前端就先放弃了
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT ?? 80000);

/** 统一的业务异常，页面只需要读 message 做提示 */
export class DiagnoseError extends Error {
  readonly code: string | number | null;
  readonly requestId: string | null;

  constructor(
    message: string,
    code: string | number | null = null,
    requestId: string | null = null
  ) {
    super(message);
    this.name = "DiagnoseError";
    this.code = code;
    this.requestId = requestId;
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const clampScore = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
};

/** 后端字段缺失时给出安全默认值，避免整页白屏 */
function normalize(data: DiagnoseResponse): DiagnoseResponse {
  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  return {
    ...data,
    overall_score: clampScore(data.overall_score),
    dimension_scores: Array.isArray(data.dimension_scores) ? data.dimension_scores : [],
    highlights: Array.isArray(data.highlights) ? data.highlights : [],
    gaps: Array.isArray(data.gaps)
      ? [...data.gaps].sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
      : [],
  };
}

/** 后端错误体有三种形态，这里统一成一句可读的中文提示 */
function toDiagnoseError(parsed: unknown, status: number): DiagnoseError {
  const body = (parsed ?? {}) as ApiErrorBody;
  const requestId = body.error?.request_id ?? null;
  const withRequestId = (message: string) =>
    requestId ? `${message}（请求编号：${requestId}）` : message;

  // 504 是模型确实超时，和生成失败分开提示，用户才知道该等还是该精简内容
  if (status === 504) {
    return new DiagnoseError(
      withRequestId("AI 响应超时，请稍后重试；内容较长时可适当精简"),
      body.error?.code ?? status,
      requestId
    );
  }

  // 其他 5xx 多为大模型生成失败；保留后端请求编号，便于用户反馈后定位日志。
  if (status >= 500) {
    return new DiagnoseError(
      withRequestId("AI 正在思考中，请稍后重试"),
      body.error?.code ?? status,
      requestId
    );
  }

  if (status === 429 && !body.error?.message) {
    return new DiagnoseError("请求过于频繁，请 1 分钟后再试", status);
  }

  // 契约预留形态：{ error: { code, message } }
  if (body.error?.message) {
    return new DiagnoseError(
      withRequestId(body.error.message),
      body.error.code ?? status,
      requestId
    );
  }

  // FastAPI 默认：{ detail: "..." }
  if (typeof body.detail === "string" && body.detail.trim()) {
    return new DiagnoseError(body.detail, status);
  }

  // FastAPI 422：{ detail: [ { loc, msg } ] }
  if (Array.isArray(body.detail) && body.detail.length > 0) {
    const first = body.detail[0] as { loc?: unknown[]; msg?: string };
    const field = Array.isArray(first.loc)
      ? first.loc.filter((item) => item !== "body").join(".")
      : "";
    const reason = first.msg ?? "请求参数不合法";
    return new DiagnoseError(field ? `参数 ${field}：${reason}` : reason, status);
  }

  if (typeof body.message === "string" && body.message.trim()) {
    return new DiagnoseError(body.message, body.code ?? status);
  }

  return new DiagnoseError(`诊断失败（HTTP ${status}）`, status);
}

/**
 * 调用诊断接口。
 * mock 模式下返回内置样例，离线调 UI 时把 .env 的 VITE_USE_MOCK 设为 true，页面代码零改动。
 */
export async function diagnose(payload: DiagnoseRequest): Promise<DiagnoseResponse> {
  if (IS_MOCK_MODE) {
    await wait(900);
    return normalize(mockResponse as DiagnoseResponse);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}/api/diagnose`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const raw = await res.text();
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        // 网关（Nginx）报错时返回的是 HTML，按状态码给提示即可
        if (res.ok) throw new DiagnoseError("诊断服务返回的内容不是合法 JSON");
      }
    }

    if (!res.ok) {
      throw toDiagnoseError(parsed, res.status);
    }

    if (!parsed || typeof parsed !== "object") {
      throw new DiagnoseError("诊断服务返回了空结果");
    }

    return normalize(parsed as DiagnoseResponse);
  } catch (error) {
    if (error instanceof DiagnoseError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new DiagnoseError(`AI 响应超时（${Math.round(TIMEOUT_MS / 1000)} 秒），请稍后重试`);
    }
    throw new DiagnoseError("网络异常，无法连接诊断服务");
  } finally {
    clearTimeout(timer);
  }
}
