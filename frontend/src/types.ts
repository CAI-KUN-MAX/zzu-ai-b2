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

/* ------------------------------------------------------------------ *
 * 简历筛选（OCR 解析 + 匹配排序）—— 与后端统一契约，不要单独改字段
 * ------------------------------------------------------------------ */

/** 异步任务状态 */
export type TaskStatus = "queued" | "running" | "succeeded" | "failed";

/** 单份简历的解析状态 */
export type ResumeStatus = "ready" | "need_review" | "failed";

/** 解析批次的单条结果 */
export interface IngestItem {
  resume_id: string;
  name: string;
  chars: number;
  status: ResumeStatus;
  /** 正文预览，用于列表展示 */
  preview: string;
  /** 单份解析失败原因；与任务级 error 不同，这里是对象 */
  error?: { code: string; message: string } | null;
  /** OCR 低置信度行数，大于 0 时状态为 need_review */
  low_conf?: number;
}

/** GET /api/tasks/{task_id} */
export interface IngestTask {
  status: TaskStatus;
  /** 面向用户的阶段文案，如「解析 3/8」 */
  stage: string;
  /** 0-100 */
  progress: number;
  /** 可直接展示的中文错误，正常时为 null */
  error: string | null;
  /** 额外错误码，如 OCR_UNAVAILABLE / TASK_INTERRUPTED */
  error_code?: string | null;
  /** 解析中的项目暂不返回，只包含 ready / need_review / failed */
  items: IngestItem[];
}

/** GET /api/resumes/{resume_id}/text */
export interface ResumeText {
  resume_id: string;
  name: string;
  chars: number;
  text: string;
}

export interface MatchSubScore {
  key: string;
  label: string;
  score: number;
  weight: number;
}

/** 匹配结果中的单份简历 */
export interface MatchItem {
  resume_id: string;
  name: string;
  /** 最终分：AI 完成时为 0.35×基础分 + 0.65×AI 分，降级时等于基础分 */
  score: number;
  /** 基础评分（技能关键词 55% + 文本相似度 30% + 学历 15%） */
  stage1_score?: number;
  level: MatchLevel;
  level_label: string;
  /** 基础评分的三个分项，与 report.dimension_scores 的 AI 四维度不是一回事 */
  subscores: MatchSubScore[];
  matched: string[];
  missing: string[];
  reason: string | null;
  /** true 表示只做了轻量打分，没有 AI 深度分析，此时 report 不存在 */
  degraded: boolean;
  /** 与 /api/diagnose 响应结构完全一致，degraded 时为 undefined */
  report?: DiagnoseResponse;
}

/** GET /api/match/{task_id} */
export interface MatchTask {
  status: TaskStatus;
  stage: string;
  progress: number;
  error: string | null;
  error_code?: string | null;
  items: MatchItem[];
}
