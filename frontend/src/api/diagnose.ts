import type { ApiErrorBody, DiagnoseRequest, DiagnoseResponse } from "../types";
import mockResponse from "../mock/response.json";

/** 是否处于 mock 模式（.env 里 VITE_USE_MOCK=true） */
export const IS_MOCK_MODE = import.meta.env.VITE_USE_MOCK !== "false";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT ?? 60000);

/** 统一的业务异常，页面只需要读 message 做提示 */
export class DiagnoseError extends Error {
  readonly code: string | number | null;

  constructor(message: string, code: string | number | null = null) {
    super(message);
    this.name = "DiagnoseError";
    this.code = code;
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
  return {
    ...data,
    overall_score: clampScore(data.overall_score),
    dimension_scores: Array.isArray(data.dimension_scores) ? data.dimension_scores : [],
    highlights: Array.isArray(data.highlights) ? data.highlights : [],
    gaps: Array.isArray(data.gaps) ? data.gaps : [],
  };
}

/** 后端错误体有三种形态，这里统一成一句可读的中文提示 */
function toDiagnoseError(parsed: unknown, status: number): DiagnoseError {
  const body = (parsed ?? {}) as ApiErrorBody;

  // 契约预留形态：{ error: { code, message } }
  if (body.error?.message) {
    return new DiagnoseError(body.error.message, body.error.code ?? status);
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
 * mock 模式下返回内置样例，联调时把 .env 的 VITE_USE_MOCK 改成 false 即可，页面代码零改动。
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
        throw new DiagnoseError("诊断服务返回的内容不是合法 JSON");
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
      throw new DiagnoseError(`请求超时（${Math.round(TIMEOUT_MS / 1000)} 秒），请稍后重试`);
    }
    throw new DiagnoseError("网络异常，无法连接诊断服务");
  } finally {
    clearTimeout(timer);
  }
}
