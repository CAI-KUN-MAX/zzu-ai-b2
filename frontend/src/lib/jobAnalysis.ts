import type { JobMatchItem } from "../types";

export function analysisDuration(item: JobMatchItem, now: number): string {
  const running = item.analysis_status === "running" || item.analysis_status === "pending";
  const ms = running && item.analysis_started_at
    ? now - Date.parse(item.analysis_started_at)
    : item.analysis_elapsed_ms;
  return ms != null && Number.isFinite(ms) ? ` · ${running ? "已用时" : "耗时"} ${Math.max(0, Math.floor(ms / 1000))} 秒` : "";
}

export function analysisFailure(item: JobMatchItem): string {
  switch (item.analysis_error) {
    case "timeout": return "AI 响应超时";
    case "invalid_output": return "AI 返回的内容未通过格式或原文证据校验";
    case "inconsistent_evidence": return "AI 结论与简历技能证据不一致，报告未采用";
    case "service_unavailable": return "AI 服务请求未成功，请稍后重试";
    case "unknown": return "本次 AI 分析出现异常，可重新分析";
    default: return item.degraded_reason === "model_failed" ? "AI 分析未成功；旧记录未保存详细原因" : "本次未完成 AI 深度分析";
  }
}
