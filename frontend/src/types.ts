/**
 * 接口契约类型（与后端 /api/diagnose 返回结构一一对应）
 * 结构已冻结，字段名不要随意改动；如需扩展请与后端同步后再改这里。
 */

/** 请求体：POST /api/diagnose（字段名与后端 backend/app/schemas.py 保持一致） */
export interface DiagnoseRequest {
  /** 简历全文（纯文本） */
  resume_text: string;
  /** 岗位 JD 全文（纯文本） */
  jd_text: string;
  /** 可选分析参数，不传时由后端使用默认值 */
  options?: DiagnoseOptions;
}

export interface DiagnoseOptions {
  language?: string;
  include_suggestions?: boolean;
}

/** 整体匹配等级 */
export type MatchLevel = "high" | "medium" | "low";

/** 缺口严重程度 */
export type GapSeverity = "high" | "medium" | "low";

/** 单一维度的得分 */
export interface DimensionScore {
  /** 维度标识，用于前端映射图标/排序，如 skill_match */
  key: string;
  /** 维度中文名，直接展示 */
  label: string;
  /** 该维度得分，0-100 */
  score: number;
  /** 该维度在总分中的权重，0-1，四项权重之和为 1 */
  weight: number;
}

/** 亮点条目 */
export interface Highlight {
  title: string;
  /** 支撑该亮点的原文证据 */
  evidence: string;
  /** 证据来源：resume / jd */
  source: string;
}

/** 缺口条目 */
export interface Gap {
  title: string;
  /** JD 中的对应要求 */
  jd_requirement: string;
  /** 简历中的现有证据（后端 Optional，可能为 null） */
  resume_evidence: string | null;
  /** 改进建议 */
  suggestion: string;
  severity: GapSeverity;
}

/** 调用元信息，便于排查线上问题 */
export interface DiagnoseMeta {
  model: string;
  /** mock / real */
  mode: string;
  elapsed_ms: number;
}

/** 响应体 */
export interface DiagnoseResponse {
  request_id: string;
  /** 总分，0-100 */
  overall_score: number;
  level: MatchLevel;
  /** 等级中文标签，如「强匹配」，直接展示，前端不再自造文案 */
  level_label: string;
  dimension_scores: DimensionScore[];
  highlights: Highlight[];
  gaps: Gap[];
  /** 一句话总结 */
  summary: string;
  /** 免责声明，由后端下发，前端原样展示 */
  disclaimer: string;
  meta: DiagnoseMeta;
}

/**
 * 错误体。后端同时存在三种形态，前端统一兼容：
 * 1. FastAPI HTTPException 默认：{ "detail": "简历或JD文本不能为空" }
 * 2. 422 参数校验失败：{ "detail": [ { "loc": [...], "msg": "..." } ] }
 * 3. 契约预留：{ "error": { "code", "message", "request_id" } }
 */
export interface ApiErrorBody {
  detail?: string | Array<Record<string, unknown>>;
  error?: {
    code: string | number;
    message: string;
    request_id?: string;
  };
  code?: string | number;
  message?: string;
}
