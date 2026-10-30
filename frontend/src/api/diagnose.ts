import type { DiagnoseRequest, DiagnoseResponse } from "../types";
import mockResponse from "../mock/response.json";
import { IS_MOCK_MODE, TIMEOUT_MS, request, wait } from "./http";

/**
 * 对外签名保持不变：页面仍从本文件引入 diagnose / DiagnoseError / IS_MOCK_MODE。
 * DiagnoseError 就是 http 层的 ApiError，instanceof 判断依然成立。
 */
export { ApiError as DiagnoseError } from "./http";
export { IS_MOCK_MODE } from "./http";

const clampScore = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
};

/** 缺口排序优先级：high → medium → low，未知值排最后 */
const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** 后端字段缺失时给出安全默认值，避免整页白屏 */
function normalize(data: DiagnoseResponse): DiagnoseResponse {
  return {
    ...data,
    overall_score: clampScore(data.overall_score),
    dimension_scores: Array.isArray(data.dimension_scores) ? data.dimension_scores : [],
    highlights: Array.isArray(data.highlights) ? data.highlights : [],
    // 后端已按优先级返回，这里再兜一层，防止 LLM 返回乱序
    gaps: Array.isArray(data.gaps)
      ? data.gaps
          .map((gap) => ({
            ...gap,
            rewrite_suggestion: gap.rewrite_suggestion ?? "",
          }))
          .sort(
          (a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3)
        )
      : [],
  };
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

  const data = await request<DiagnoseResponse>("/api/diagnose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMessage: `AI 响应超时（${Math.round(TIMEOUT_MS / 1000)} 秒），请稍后重试`,
  });

  return normalize(data);
}
